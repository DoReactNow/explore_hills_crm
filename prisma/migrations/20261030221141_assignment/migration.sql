-- CreateEnum
CREATE TYPE "AssignmentMode" AS ENUM ('MANUAL', 'ROUND_ROBIN', 'LEAST_LOADED', 'PRIORITY', 'RANDOM', 'BLAST');

-- CreateEnum
CREATE TYPE "AssignmentBatchStatus" AS ENUM ('COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssignmentPoolStatus" AS ENUM ('OPEN', 'CLAIMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "assignment_agent_settings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "openLeadCap" INTEGER,
    "priorityTier" INTEGER NOT NULL DEFAULT 0,
    "languages" TEXT[],
    "destinations" TEXT[],
    "leaveFromDate" DATE,
    "leaveToDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_agent_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_shifts" (
    "id" UUID NOT NULL,
    "settingId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "assignment_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AssignmentMode" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isAutoAssign" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoAssignedUntil" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_batches" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "mode" "AssignmentMode" NOT NULL,
    "requestedByUserId" UUID,
    "status" "AssignmentBatchStatus" NOT NULL,
    "leadCount" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_records" (
    "id" UUID NOT NULL,
    "batchId" UUID,
    "leadId" UUID NOT NULL,
    "fromUserId" UUID,
    "toUserId" UUID NOT NULL,
    "actorUserId" UUID,
    "mode" "AssignmentMode" NOT NULL,
    "reason" TEXT,
    "responseDueAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "timedOutAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_escalations" (
    "leadId" UUID NOT NULL,
    "timeouts" INTEGER NOT NULL,
    "escalatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_escalations_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "assignment_pool_entries" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "batchId" UUID,
    "status" "AssignmentPoolStatus" NOT NULL DEFAULT 'OPEN',
    "claimedByUserId" UUID,
    "claimedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_pool_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_pool_eligibility" (
    "poolEntryId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "assignment_pool_eligibility_pkey" PRIMARY KEY ("poolEntryId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_agent_settings_userId_key" ON "assignment_agent_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_shifts_settingId_weekday_startMinute_key" ON "assignment_shifts"("settingId", "weekday", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_rules_name_key" ON "assignment_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_batches_idempotencyKey_key" ON "assignment_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "assignment_batches_createdAt_idx" ON "assignment_batches"("createdAt");

-- CreateIndex
CREATE INDEX "assignment_records_leadId_createdAt_idx" ON "assignment_records"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "assignment_records_toUserId_createdAt_idx" ON "assignment_records"("toUserId", "createdAt");

-- CreateIndex
CREATE INDEX "assignment_records_responseDueAt_idx" ON "assignment_records"("responseDueAt");

-- CreateIndex
CREATE INDEX "assignment_pool_entries_status_expiresAt_idx" ON "assignment_pool_entries"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "assignment_pool_entries_leadId_idx" ON "assignment_pool_entries"("leadId");

-- CreateIndex
CREATE INDEX "assignment_pool_eligibility_userId_idx" ON "assignment_pool_eligibility"("userId");

-- AddForeignKey
ALTER TABLE "assignment_agent_settings" ADD CONSTRAINT "assignment_agent_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_shifts" ADD CONSTRAINT "assignment_shifts_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "assignment_agent_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_records" ADD CONSTRAINT "assignment_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "assignment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_records" ADD CONSTRAINT "assignment_records_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_records" ADD CONSTRAINT "assignment_records_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_records" ADD CONSTRAINT "assignment_records_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_escalations" ADD CONSTRAINT "assignment_escalations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pool_entries" ADD CONSTRAINT "assignment_pool_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pool_entries" ADD CONSTRAINT "assignment_pool_entries_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pool_eligibility" ADD CONSTRAINT "assignment_pool_eligibility_poolEntryId_fkey" FOREIGN KEY ("poolEntryId") REFERENCES "assignment_pool_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pool_eligibility" ADD CONSTRAINT "assignment_pool_eligibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open pool entry per lead (P5-BLAST-01), and at most one active auto-assign rule (P5-REASSIGN-07).
CREATE UNIQUE INDEX "assignment_pool_entries_one_open_per_lead" ON "assignment_pool_entries"("leadId") WHERE status = 'OPEN';
CREATE UNIQUE INDEX "assignment_rules_one_active_auto" ON "assignment_rules"("isAutoAssign") WHERE "isAutoAssign" AND "isActive";

-- Shifts stay inside a day and last at least a minute; a cap can't be negative.
ALTER TABLE "assignment_shifts" ADD CONSTRAINT "assignment_shifts_valid" CHECK (weekday BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1439 AND "startMinute" <> "endMinute");
ALTER TABLE "assignment_agent_settings" ADD CONSTRAINT "assignment_agent_settings_cap" CHECK ("openLeadCap" IS NULL OR "openLeadCap" >= 0);
