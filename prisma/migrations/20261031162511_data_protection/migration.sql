-- CreateEnum
CREATE TYPE "LeadsConsentPurpose" AS ENUM ('WHATSAPP', 'CALL_RECORDING');

-- CreateEnum
CREATE TYPE "LeadsConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "leads_contacts" ADD COLUMN     "legalHoldAt" TIMESTAMPTZ(3),
ADD COLUMN     "recordingOptOutAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "system_file_deletions" (
    "id" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_file_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads_consent_records" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "purpose" "LeadsConsentPurpose" NOT NULL,
    "status" "LeadsConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "recordedByUserId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_file_deletions_storageKey_key" ON "system_file_deletions"("storageKey");

-- CreateIndex
CREATE INDEX "system_file_deletions_createdAt_idx" ON "system_file_deletions"("createdAt");

-- CreateIndex
CREATE INDEX "leads_consent_records_contactId_occurredAt_idx" ON "leads_consent_records"("contactId", "occurredAt");

-- AddForeignKey
ALTER TABLE "leads_consent_records" ADD CONSTRAINT "leads_consent_records_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "leads_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads_consent_records" ADD CONSTRAINT "leads_consent_records_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Consent records are proof, so they are append-only like the audit trail.
CREATE FUNCTION "leads_consent_records_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'leads_consent_records is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "leads_consent_records_append_only"
  BEFORE UPDATE OR DELETE ON "leads_consent_records"
  FOR EACH ROW EXECUTE FUNCTION "leads_consent_records_append_only"();

-- What is already known about WhatsApp opt-in becomes the first record for each contact.
INSERT INTO "leads_consent_records" ("id", "contactId", "purpose", "status", "source", "occurredAt")
SELECT gen_random_uuid(), "id", 'WHATSAPP'::"LeadsConsentPurpose",
       CASE "optInStatus" WHEN 'OPTED_IN' THEN 'GRANTED'::"LeadsConsentStatus" ELSE 'WITHDRAWN'::"LeadsConsentStatus" END,
       COALESCE("optInSource", 'unknown'), "optInAt"
FROM "leads_contacts"
WHERE "optInStatus" <> 'UNKNOWN' AND "optInAt" IS NOT NULL;
