-- An erased customer keeps their row, with a placeholder that can't be a number (Decision 66).
ALTER TABLE "leads_contacts" DROP CONSTRAINT "leads_contacts_phone_e164";
ALTER TABLE "leads_contacts" ADD CONSTRAINT "leads_contacts_phone_e164" CHECK (
  "phoneE164" ~ '^\+[1-9][0-9]{6,14}$'
  OR ("anonymisedAt" IS NOT NULL AND "phoneE164" ~ '^erased-[a-z]+$')
);
