// A customer's rights under the data protection law (Decision 66): seeing what's held, consent, holds
// and erasure. It owns no table: each module keeps and erases its own data through its public API.
import { eraseAssignmentReasons } from "@/modules/assignment";
import { recordAudit } from "@/modules/audit";
import {
  addConsentRecord,
  anonymiseContact,
  auditConsent,
  contactHasOpenLead,
  exportContactRecord,
  findContactForChange,
  findContactRecord,
  leadIdsOfContact,
  lockContactPhone,
  normalisePhone,
  searchContacts,
  setContactHold,
  setContactOpt,
  setRecordingOptOut,
} from "@/modules/leads";
import {
  eraseContactMessages,
  eraseMessagingWebhookEvents,
  exportContactMessages,
} from "@/modules/messaging";
import { eraseLeadNotifications } from "@/modules/notifications";
import { enqueueFileDeletions, pendingFileDeletions, runFileDeletions } from "@/modules/system";
import {
  contactOnActiveCall,
  eraseContactCalls,
  eraseTelephonyWebhookEvents,
  exportContactCalls,
  lockCallPhone,
} from "@/modules/telephony";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { assertCan } from "@/shared/rbac/assertCan";
import type { Principal } from "@/shared/rbac/principal";
import { systemClock, type Clock } from "@/shared/time";
import { privacyTransaction as transaction } from "./privacy.repository";
import type { ConsentInput, EraseInput, HoldInput, SearchInput } from "./privacy.schemas";

export interface PrivacyContext {
  principal: Principal;
  requestId?: string;
}

const SEARCH_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new AppError("NOT_FOUND");
const refuse = (message: string) =>
  new AppError("CONFLICT", { fieldErrors: [{ field: "_root", message }] });

const actorOf = ({ principal }: PrivacyContext) => ({
  userId: principal.userId,
  roleCode: principal.roleCode,
});

export function createPrivacyService(clock: Clock = systemClock) {
  return {
    async search({ principal }: PrivacyContext, { search }: SearchInput) {
      assertCan(principal, "privacy:manage");
      return { contacts: await searchContacts(search, SEARCH_LIMIT) };
    },

    /** Opening one customer's whole record is itself recorded (P10-AUDV-04). */
    async getRecord(context: PrivacyContext, id: string) {
      assertCan(context.principal, "privacy:manage");
      if (!UUID.test(id)) throw notFound();
      const record = await findContactRecord(id);
      if (!record) throw notFound();
      await transaction((tx) =>
        recordAudit(tx, {
          action: "contact.viewed",
          entityType: "contact",
          entityId: id,
          summary: "Customer privacy record opened",
          actor: actorOf(context),
          requestId: context.requestId,
        }),
      );
      return { contact: record, filesWaiting: await pendingFileDeletions() };
    },

    async recordConsent(context: PrivacyContext, id: string, input: ConsentInput) {
      assertCan(context.principal, "privacy:manage");
      if (!UUID.test(id)) throw notFound();
      const now = clock.now();
      await transaction(async (tx) => {
        const contact = await findContactForChange(tx, id);
        if (!contact) throw notFound();
        if (contact.anonymisedAt) throw refuse("This customer's data was erased.");
        if (input.purpose === "WHATSAPP") {
          const status = input.status === "GRANTED" ? "OPTED_IN" : "OPTED_OUT";
          if (contact.optInStatus === status) return;
          await setContactOpt(tx, {
            contactId: id,
            status,
            source: input.source,
            at: now,
            actor: actorOf(context),
            requestId: context.requestId,
          });
          return;
        }
        const withdrawn = input.status === "WITHDRAWN";
        if (Boolean(contact.recordingOptOutAt) === withdrawn) return;
        await setRecordingOptOut(tx, id, withdrawn ? now : null);
        await addConsentRecord(tx, {
          contactId: id,
          purpose: "CALL_RECORDING",
          status: input.status,
          source: input.source,
          recordedByUserId: context.principal.userId,
          occurredAt: now,
        });
        await auditConsent(tx, {
          contactId: id,
          purpose: input.purpose,
          status: input.status,
          source: input.source,
          actor: actorOf(context),
          requestId: context.requestId,
        });
      });
      return { saved: true };
    },

    async setHold(context: PrivacyContext, id: string, input: HoldInput) {
      assertCan(context.principal, "privacy:manage");
      if (!UUID.test(id)) throw notFound();
      if (input.on && !input.reason) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "reason", message: "Please choose why the hold is needed." }],
        });
      }
      const now = clock.now();
      await transaction(async (tx) => {
        const contact = await findContactForChange(tx, id);
        if (!contact) throw notFound();
        if (contact.anonymisedAt) throw refuse("This customer's data was erased.");
        if (Boolean(contact.legalHoldAt) === input.on) return;
        await setContactHold(tx, id, input.on ? now : null);
        await recordAudit(tx, {
          action: "contact.hold_changed",
          entityType: "contact",
          entityId: id,
          summary: input.on ? "Hold placed on customer data" : "Hold on customer data released",
          actor: actorOf(context),
          requestId: context.requestId,
          metadata: { on: input.on, reason: input.reason ?? null },
        });
      });
      return { saved: true };
    },

    /** Everything held about this one customer. Files are listed, not attached (Decision 66). */
    async exportData(context: PrivacyContext, id: string) {
      assertCan(context.principal, "privacy:export");
      if (!UUID.test(id)) throw notFound();
      const record = await exportContactRecord(id);
      if (!record) throw notFound();
      if (record.phone.startsWith("erased-")) {
        throw refuse("This customer's data was erased, so there's nothing to export.");
      }
      const { leadIds, ...person } = record;
      const body = {
        company: APP_CONFIG.company.legalName,
        generatedAt: clock.now(),
        ...person,
        messages: await exportContactMessages(id),
        calls: await exportContactCalls(record.phone, leadIds),
      };
      await transaction((tx) =>
        recordAudit(tx, {
          action: "contact.data_exported",
          entityType: "contact",
          entityId: id,
          summary: "Customer data exported",
          actor: actorOf(context),
          requestId: context.requestId,
        }),
      );
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="customer-data-${id}.json"`,
          "cache-control": "private, no-store",
        },
      });
    },

    /**
     * Erasure (P10-ERASE-01 to -06). All or nothing in one transaction; files follow through the
     * deletion list, which keeps trying. Running it again changes nothing. The person must type the
     * customer's number, so it can't land on the wrong customer.
     */
    async erase(context: PrivacyContext, id: string, input: EraseInput) {
      assertCan(context.principal, "privacy:erase");
      if (!UUID.test(id)) throw notFound();
      const now = clock.now();
      const result = await transaction(async (tx) => {
        const first = await findContactForChange(tx, id);
        if (!first) throw notFound();
        await lockContactPhone(tx, first.phoneE164);
        await lockCallPhone(tx, first.phoneE164);
        const contact = await findContactForChange(tx, id);
        if (!contact) throw notFound();
        if (contact.anonymisedAt) return { alreadyErased: true, files: 0 };

        const typed = normalisePhone(input.confirmPhone);
        if (typed !== contact.phoneE164) {
          throw new AppError("VALIDATION_FAILED", {
            fieldErrors: [{ field: "confirmPhone", message: "That isn't this customer's number." }],
          });
        }
        if (contact.legalHoldAt) {
          throw refuse("This customer is on hold. Please release the hold first.");
        }
        if (await contactHasOpenLead(tx, id)) {
          throw refuse("This customer has an open lead. Please close it first.");
        }
        if (await contactOnActiveCall(tx, contact.phoneE164, await leadIdsOfContact(tx, id))) {
          throw refuse("This customer is on a call. Please try again after it ends.");
        }

        const phone = contact.phoneE164;
        const digits = phone.replace(/\D/g, "");
        const leadIds = await anonymiseContact(tx, id, now);
        await addConsentRecord(tx, {
          contactId: id,
          purpose: "WHATSAPP",
          status: "WITHDRAWN",
          source: "erasure",
          recordedByUserId: context.principal.userId,
          occurredAt: now,
        });
        await addConsentRecord(tx, {
          contactId: id,
          purpose: "CALL_RECORDING",
          status: "WITHDRAWN",
          source: "erasure",
          recordedByUserId: context.principal.userId,
          occurredAt: now,
        });
        const mediaKeys = await eraseContactMessages(tx, id);
        const recordingKeys = await eraseContactCalls(tx, phone, leadIds, now);
        await eraseMessagingWebhookEvents(tx, digits);
        await eraseTelephonyWebhookEvents(tx, digits);
        await eraseLeadNotifications(tx, leadIds);
        await eraseAssignmentReasons(tx, leadIds);
        const files = [...mediaKeys, ...recordingKeys];
        await enqueueFileDeletions(tx, files, "erasure");
        await recordAudit(tx, {
          action: "contact.erased",
          entityType: "contact",
          entityId: id,
          summary: "Customer data erased",
          actor: actorOf(context),
          requestId: context.requestId,
          metadata: { leads: leadIds.length, files: files.length },
        });
        return { alreadyErased: false, files: files.length };
      });
      if (result.files > 0) {
        await runFileDeletions().catch((error: unknown) =>
          logger.warn("could not delete files straight away", { err: error }),
        );
      }
      return {
        erased: true,
        alreadyErased: result.alreadyErased,
        filesWaiting: await pendingFileDeletions(),
      };
    },
  };
}

export const privacyService = createPrivacyService();
