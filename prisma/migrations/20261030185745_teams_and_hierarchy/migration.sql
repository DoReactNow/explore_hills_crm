-- AlterTable
ALTER TABLE "identity_users" ADD COLUMN     "managerId" UUID;

-- CreateTable
CREATE TABLE "identity_teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managerUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_team_members" (
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_team_members_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_teams_name_key" ON "identity_teams"("name");

-- CreateIndex
CREATE INDEX "identity_teams_managerUserId_idx" ON "identity_teams"("managerUserId");

-- CreateIndex
CREATE INDEX "identity_team_members_userId_idx" ON "identity_team_members"("userId");

-- CreateIndex
CREATE INDEX "identity_users_managerId_idx" ON "identity_users"("managerId");

-- AddForeignKey
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_teams" ADD CONSTRAINT "identity_teams_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_team_members" ADD CONSTRAINT "identity_team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "identity_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_team_members" ADD CONSTRAINT "identity_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules Prisma cannot express (Decision 55).
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_not_own_manager" CHECK ("managerId" IS NULL OR "managerId" <> "id");
CREATE UNIQUE INDEX "identity_teams_name_lower_key" ON "identity_teams" (lower("name"));
CREATE UNIQUE INDEX "identity_roles_name_lower_key" ON "identity_roles" (lower("name"));
