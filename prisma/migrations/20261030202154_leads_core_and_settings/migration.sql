-- CreateEnum
CREATE TYPE "LeadsSource" AS ENUM ('WHATSAPP', 'PHONE', 'MANUAL', 'WEBSITE', 'AD', 'IMPORT');

-- CreateEnum
CREATE TYPE "LeadsStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadsOptInStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "LeadsTimelineKind" AS ENUM ('LEAD_CREATED', 'STAGE_CHANGED', 'ASSIGNED', 'NOTE', 'MESSAGE', 'CALL', 'TASK');

-- CreateTable
CREATE TABLE "leads_pipeline_stages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LeadsStageKind" NOT NULL DEFAULT 'OPEN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_contacts" (
    "id" UUID NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "optInStatus" "LeadsOptInStatus" NOT NULL DEFAULT 'UNKNOWN',
    "optInAt" TIMESTAMPTZ(3),
    "optInSource" TEXT,
    "anonymisedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "leads_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_leads" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "source" "LeadsSource" NOT NULL DEFAULT 'WHATSAPP',
    "sourceDetail" TEXT,
    "stageId" UUID NOT NULL,
    "ownerUserId" UUID,
    "assignedAt" TIMESTAMPTZ(3),
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "destination" TEXT,
    "travelStartDate" DATE,
    "travelEndDate" DATE,
    "travellerCount" INTEGER,
    "budgetAmount" DECIMAL(12,2),
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "firstResponseAt" TIMESTAMPTZ(3),
    "lastActivityAt" TIMESTAMPTZ(3),
    "nextFollowUpDate" DATE,
    "closedAt" TIMESTAMPTZ(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "leads_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_notes" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_tasks" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "assigneeUserId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_timeline_entries" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "kind" "LeadsTimelineKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actorUserId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_pipeline_stages_code_key" ON "leads_pipeline_stages"("code");

-- CreateIndex
CREATE INDEX "leads_pipeline_stages_position_idx" ON "leads_pipeline_stages"("position");

-- CreateIndex
CREATE UNIQUE INDEX "leads_contacts_phoneE164_key" ON "leads_contacts"("phoneE164");

-- CreateIndex
CREATE INDEX "leads_leads_ownerUserId_stageId_idx" ON "leads_leads"("ownerUserId", "stageId");

-- CreateIndex
CREATE INDEX "leads_leads_stageId_idx" ON "leads_leads"("stageId");

-- CreateIndex
CREATE INDEX "leads_leads_ownerUserId_createdAt_idx" ON "leads_leads"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_leads_nextFollowUpDate_idx" ON "leads_leads"("nextFollowUpDate");

-- CreateIndex
CREATE INDEX "leads_leads_createdAt_idx" ON "leads_leads"("createdAt");

-- CreateIndex
CREATE INDEX "leads_leads_contactId_idx" ON "leads_leads"("contactId");

-- CreateIndex
CREATE INDEX "leads_leads_deletedAt_idx" ON "leads_leads"("deletedAt");

-- CreateIndex
CREATE INDEX "leads_notes_leadId_createdAt_idx" ON "leads_notes"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_notes_authorUserId_idx" ON "leads_notes"("authorUserId");

-- CreateIndex
CREATE INDEX "leads_tasks_assigneeUserId_dueDate_idx" ON "leads_tasks"("assigneeUserId", "dueDate");

-- CreateIndex
CREATE INDEX "leads_tasks_leadId_idx" ON "leads_tasks"("leadId");

-- CreateIndex
CREATE INDEX "leads_timeline_entries_leadId_occurredAt_idx" ON "leads_timeline_entries"("leadId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_timeline_entries_refType_refId_kind_key" ON "leads_timeline_entries"("refType", "refId", "kind");

-- AddForeignKey
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "leads_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "leads_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_notes" ADD CONSTRAINT "leads_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_notes" ADD CONSTRAINT "leads_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_tasks" ADD CONSTRAINT "leads_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_tasks" ADD CONSTRAINT "leads_tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_timeline_entries" ADD CONSTRAINT "leads_timeline_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_timeline_entries" ADD CONSTRAINT "leads_timeline_entries_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma cannot express.
ALTER TABLE "leads_contacts" ADD CONSTRAINT "leads_contacts_phone_e164" CHECK ("phoneE164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_trip_dates" CHECK ("travelEndDate" IS NULL OR "travelStartDate" IS NULL OR "travelEndDate" >= "travelStartDate");
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_travellers" CHECK ("travellerCount" IS NULL OR "travellerCount" > 0);
ALTER TABLE "leads_leads" ADD CONSTRAINT "leads_leads_budget" CHECK ("budgetAmount" IS NULL OR "budgetAmount" >= 0);
