-- CreateEnum
CREATE TYPE "IdentityUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "identity_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "IdentityUserStatus" NOT NULL DEFAULT 'INVITED',
    "roleId" UUID NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "identity_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_login_throttle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_login_throttle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "actorUserId" UUID,
    "actorRoleCode" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_users_email_key" ON "identity_users"("email");

-- CreateIndex
CREATE INDEX "identity_users_roleId_idx" ON "identity_users"("roleId");

-- CreateIndex
CREATE INDEX "identity_users_status_idx" ON "identity_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "identity_sessions_tokenHash_key" ON "identity_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "identity_sessions_userId_idx" ON "identity_sessions"("userId");

-- CreateIndex
CREATE INDEX "identity_sessions_expiresAt_idx" ON "identity_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "identity_login_throttle_windowStart_idx" ON "identity_login_throttle"("windowStart");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_occurredAt_idx" ON "audit_events"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_occurredAt_idx" ON "audit_events"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_action_occurredAt_idx" ON "audit_events"("action", "occurredAt");

-- AddForeignKey
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL Prisma cannot express (CONTEXT/database_schema.md Section 6).
-- ---------------------------------------------------------------------------

-- Emails are stored lowercase, and uniqueness ignores case as well.
CREATE UNIQUE INDEX "identity_users_email_lower_key" ON "identity_users" (lower("email"));

-- Phone numbers are E.164 only.
ALTER TABLE "identity_users"
  ADD CONSTRAINT "identity_users_phone_e164_check"
  CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{6,14}$');

-- The audit trail is append-only. TRUNCATE (used only by the test reset) is not a row change,
-- so it is not blocked; the application never truncates.
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
