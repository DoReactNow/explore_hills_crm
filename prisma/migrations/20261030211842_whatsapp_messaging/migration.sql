-- CreateEnum
CREATE TYPE "MessagingDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessagingMessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'TEMPLATE', 'INTERACTIVE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "MessagingMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "MessagingTemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

-- AlterTable
ALTER TABLE "leads_leads" ADD COLUMN     "mergedIntoLeadId" UUID;

-- CreateTable
CREATE TABLE "messaging_conversations" (
    "id" UUID NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "leadId" UUID,
    "lastInboundAt" TIMESTAMPTZ(3),
    "lastMessageAt" TIMESTAMPTZ(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messaging_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessagingDirection" NOT NULL,
    "type" "MessagingMessageType" NOT NULL,
    "waMessageId" TEXT,
    "clientRef" TEXT,
    "replyToWaId" TEXT,
    "body" TEXT,
    "mediaRef" TEXT,
    "mediaStatus" TEXT,
    "mediaMimeType" TEXT,
    "mediaFilename" TEXT,
    "templateName" TEXT,
    "templateId" UUID,
    "templateVariables" JSONB,
    "status" "MessagingMessageStatus" NOT NULL,
    "failureCode" TEXT,
    "sentByUserId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "MessagingTemplateCategory" NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "providerRef" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messaging_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_webhook_events" (
    "id" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "waMessageId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "messaging_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messaging_conversations_lastMessageAt_idx" ON "messaging_conversations"("lastMessageAt");

-- CreateIndex
CREATE INDEX "messaging_conversations_leadId_idx" ON "messaging_conversations"("leadId");

-- CreateIndex
CREATE INDEX "messaging_conversations_contactId_idx" ON "messaging_conversations"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_conversations_businessPhoneNumberId_waId_key" ON "messaging_conversations"("businessPhoneNumberId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_messages_waMessageId_key" ON "messaging_messages"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_messages_clientRef_key" ON "messaging_messages"("clientRef");

-- CreateIndex
CREATE INDEX "messaging_messages_conversationId_occurredAt_idx" ON "messaging_messages"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "messaging_messages_sentByUserId_idx" ON "messaging_messages"("sentByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_templates_name_language_key" ON "messaging_templates"("name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_webhook_events_eventKey_key" ON "messaging_webhook_events"("eventKey");

-- CreateIndex
CREATE INDEX "messaging_webhook_events_receivedAt_idx" ON "messaging_webhook_events"("receivedAt");

-- CreateIndex
CREATE INDEX "messaging_webhook_events_waMessageId_idx" ON "messaging_webhook_events"("waMessageId");

-- AddForeignKey
ALTER TABLE "messaging_conversations" ADD CONSTRAINT "messaging_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "leads_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_conversations" ADD CONSTRAINT "messaging_conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "messaging_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
