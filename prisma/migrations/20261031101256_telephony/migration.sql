-- CreateEnum
CREATE TYPE "TelephonyDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "TelephonyChannel" AS ENUM ('BROWSER', 'PHONE');

-- CreateEnum
CREATE TYPE "TelephonyCallStatus" AS ENUM ('INITIATED', 'RINGING_AGENT', 'RINGING_CUSTOMER', 'ANSWERED', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TelephonyRecordingStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'STORED', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "telephony_agent_endpoints" (
    "id" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "loginEncrypted" TEXT,
    "secretEncrypted" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "telephony_agent_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_calls" (
    "id" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerCallId" TEXT,
    "callRef" TEXT NOT NULL,
    "direction" "TelephonyDirection" NOT NULL DEFAULT 'OUTBOUND',
    "channel" "TelephonyChannel" NOT NULL DEFAULT 'BROWSER',
    "status" "TelephonyCallStatus" NOT NULL DEFAULT 'INITIATED',
    "leadId" UUID,
    "agentUserId" UUID,
    "customerPhoneE164" TEXT NOT NULL,
    "routingNote" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "answeredAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "durationSeconds" INTEGER,
    "billableSeconds" INTEGER,
    "outcomeCode" TEXT,
    "outcomeNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "telephony_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_recordings" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "status" "TelephonyRecordingStatus" NOT NULL DEFAULT 'PENDING',
    "providerRecordingRef" TEXT,
    "storageKey" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "durationSeconds" INTEGER,
    "checksumSha256" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "readyAt" TIMESTAMPTZ(3),
    "storedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "telephony_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_webhook_events" (
    "id" UUID NOT NULL,
    "providerKey" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "telephony_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telephony_agent_endpoints_providerKey_userId_key" ON "telephony_agent_endpoints"("providerKey", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_calls_callRef_key" ON "telephony_calls"("callRef");

-- CreateIndex
CREATE INDEX "telephony_calls_leadId_startedAt_idx" ON "telephony_calls"("leadId", "startedAt");

-- CreateIndex
CREATE INDEX "telephony_calls_agentUserId_startedAt_idx" ON "telephony_calls"("agentUserId", "startedAt");

-- CreateIndex
CREATE INDEX "telephony_calls_customerPhoneE164_idx" ON "telephony_calls"("customerPhoneE164");

-- CreateIndex
CREATE INDEX "telephony_calls_status_idx" ON "telephony_calls"("status");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_calls_providerKey_providerCallId_key" ON "telephony_calls"("providerKey", "providerCallId");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_recordings_callId_key" ON "telephony_recordings"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_recordings_storageKey_key" ON "telephony_recordings"("storageKey");

-- CreateIndex
CREATE INDEX "telephony_recordings_status_idx" ON "telephony_recordings"("status");

-- CreateIndex
CREATE INDEX "telephony_recordings_expiresAt_idx" ON "telephony_recordings"("expiresAt");

-- CreateIndex
CREATE INDEX "telephony_webhook_events_receivedAt_idx" ON "telephony_webhook_events"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_webhook_events_providerKey_eventKey_key" ON "telephony_webhook_events"("providerKey", "eventKey");

-- AddForeignKey
ALTER TABLE "telephony_agent_endpoints" ADD CONSTRAINT "telephony_agent_endpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_calls" ADD CONSTRAINT "telephony_calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_calls" ADD CONSTRAINT "telephony_calls_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_recordings" ADD CONSTRAINT "telephony_recordings_callId_fkey" FOREIGN KEY ("callId") REFERENCES "telephony_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
