-- CreateTable
CREATE TABLE "identity_permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "isReserved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "bypassesAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "identity_role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "system_worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastBeatAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_permissions_code_key" ON "identity_permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "identity_roles_code_key" ON "identity_roles"("code");

-- CreateIndex
CREATE INDEX "identity_role_permissions_permissionId_idx" ON "identity_role_permissions"("permissionId");

-- AddForeignKey
ALTER TABLE "identity_role_permissions" ADD CONSTRAINT "identity_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_role_permissions" ADD CONSTRAINT "identity_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "identity_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL Prisma cannot express (CONTEXT/database_schema.md Section 6).
-- ---------------------------------------------------------------------------

-- At most one role bypasses access checks (SUPER_ADMIN).
CREATE UNIQUE INDEX "identity_roles_single_bypass_key"
  ON "identity_roles" ("bypassesAccess")
  WHERE "bypassesAccess";

-- System roles cannot be deleted. The bypass role cannot be deleted, and its "code" and
-- "bypassesAccess" never change (other columns such as "updatedAt" may, so upserts work).
CREATE FUNCTION "identity_roles_protect"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isSystem" OR OLD."bypassesAccess" THEN
      RAISE EXCEPTION 'identity_roles: system role "%" cannot be deleted', OLD."code"
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."bypassesAccess"
     AND (NEW."code" IS DISTINCT FROM OLD."code"
          OR NEW."bypassesAccess" IS DISTINCT FROM OLD."bypassesAccess") THEN
    RAISE EXCEPTION 'identity_roles: the bypass role "%" cannot change its code or bypass flag', OLD."code"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "identity_roles_protect"
  BEFORE UPDATE OR DELETE ON "identity_roles"
  FOR EACH ROW EXECUTE FUNCTION "identity_roles_protect"();

-- Reserved permissions are never granted, and the bypass role holds no grants (Decision 23).
CREATE FUNCTION "identity_role_permissions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "identity_permissions"
             WHERE "id" = NEW."permissionId" AND "isReserved") THEN
    RAISE EXCEPTION 'identity_role_permissions: reserved permissions cannot be granted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "identity_roles"
             WHERE "id" = NEW."roleId" AND "bypassesAccess") THEN
    RAISE EXCEPTION 'identity_role_permissions: the bypass role cannot hold grants'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "identity_role_permissions_guard"
  BEFORE INSERT OR UPDATE ON "identity_role_permissions"
  FOR EACH ROW EXECUTE FUNCTION "identity_role_permissions_guard"();
