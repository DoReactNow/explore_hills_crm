// The WhatsApp rules (project_data.md 3.2, Decision 58): store the webhook and answer fast, process in
// a job, enforce the 24-hour window and opt-out on the server, and send through a job so an outage
// never loses a message. The gateway hides whether that means Meta or a reseller.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import {
  addLeadTimeline,
  findLeadOwner,
  findLeadForChat,
  leadScopeOf,
  normalisePhone,
  recordFirstResponse,
  resolveLeadForInbound,
  setContactOpt,
  touchLeadActivity,
} from "@/modules/leads";
import { AppError } from "@/shared/errors";
import { getJobQueue } from "@/shared/jobs";
import { logger } from "@/shared/logger";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { notify } from "@/modules/notifications";
import { publishEvent } from "@/shared/realtime/publish";
import { buildKey, getFileStorage } from "@/shared/storage";
import { parseInstant, plusDuration, systemClock, toBusinessDate, type Clock } from "@/shared/time";
import { getWhatsAppGateway } from "./gateway/registry";
import {
  GatewayError,
  type GatewayEvent,
  type InboundMessageEvent,
  type StatusEvent,
  type WhatsAppGateway,
} from "./gateway/types";
import { conversationChangedEvent } from "./messaging.events";
import { downloadMediaRef, processEventRef, sendMessageRef } from "./messaging.jobdefs";
import {
  messagingRepository,
  type ConversationRow,
  type MessageRow,
  type MessagingRepository,
} from "./messaging.repository";
import type {
  CreateTemplateInput,
  ListConversationsInput,
  ListTemplatesInput,
  SendTemplateInput,
  SendTextInput,
  UpdateTemplateInput,
} from "./messaging.schemas";
import {
  FILE_TYPES,
  MAX_RECEIVED_FILE_BYTES,
  MAX_WEBHOOK_BYTES,
  WINDOW_HOURS,
  failureMessage,
  isOptIn,
  isOptOut,
  renderTemplate,
  templatePlaceholders,
} from "./messaging.types";

export interface MessagingContext {
  principal: Principal;
  requestId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });
const refused = (message: string) =>
  new AppError("CONFLICT", { fieldErrors: [{ field: "_root", message }] });

const WINDOW_CLOSED = "The 24-hour reply window has closed. Send an approved template.";
const OPTED_OUT =
  "This customer has opted out of WhatsApp messages. They need to send START to opt back in.";

function toMessageView(message: MessageRow) {
  const { failureCode, ...rest } = message;
  return {
    ...rest,
    failureMessage: message.status === "FAILED" ? failureMessage(failureCode) : null,
  };
}

const MESSAGE_PAGE = 50;

interface Deps {
  repository?: MessagingRepository;
  clock?: Clock;
  gateway?: () => WhatsAppGateway;
}

export function createMessagingService({
  repository = messagingRepository,
  clock = systemClock,
  gateway = getWhatsAppGateway,
}: Deps = {}) {
  function windowOf(lastInboundAt: Date | null) {
    if (!lastInboundAt) return { open: false, closesAt: null };
    const closesAt = plusDuration(lastInboundAt, { hours: WINDOW_HOURS });
    return { open: clock.now().getTime() < closesAt.getTime(), closesAt: closesAt.toISOString() };
  }

  const toConversationView = (row: ConversationRow) => ({
    ...row,
    window: windowOf(row.lastInboundAt),
  });

  const announce = (conversationId: string) =>
    publishEvent(conversationChangedEvent, { conversationId }).catch((error: unknown) =>
      logger.warn("could not publish a conversation notice", { err: error }),
    );

  const auditTemplate = (
    tx: Parameters<typeof recordAudit>[0],
    { principal, requestId }: MessagingContext,
    action: AuditAction,
    id: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType: "template",
      entityId: id,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  async function loadConversation(principal: Principal, id: string): Promise<ConversationRow> {
    if (!UUID.test(id)) throw notFound();
    const row = await repository.findConversation(id, await leadScopeOf(principal));
    if (!row) throw notFound();
    return row;
  }

  /** Inserts the outbound message and queues its send. The same key twice gives the same message. */
  async function queueOutbound(
    { principal }: MessagingContext,
    conversation: ConversationRow,
    data: {
      clientRef: string;
      type: "TEXT" | "TEMPLATE" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
      body: string | null;
      templateName?: string;
      templateId?: string;
      templateVariables?: string[];
      mediaRef?: string;
      mediaStatus?: string;
      mediaMimeType?: string;
      mediaFilename?: string;
      id?: string;
    },
  ) {
    const existing = await repository.findByClientRef(null, data.clientRef);
    if (existing) return toMessageView(existing);
    const now = clock.now();
    let message: MessageRow;
    try {
      message = await repository.transaction(async (tx) => {
        const created = await repository.createOutbound(tx, {
          ...data,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          status: "QUEUED",
          sentByUserId: principal.userId,
          occurredAt: now,
        });
        await repository.recordOutboundOnConversation(tx, conversation.id, now);
        if (conversation.lead) {
          await addLeadTimeline(tx, {
            leadId: conversation.lead.id,
            kind: "MESSAGE",
            summary:
              data.type === "TEMPLATE"
                ? `Template sent: ${data.templateName}`
                : "WhatsApp message sent",
            refType: "message",
            refId: created.id,
            actorUserId: principal.userId,
            occurredAt: now,
          });
          await touchLeadActivity(tx, conversation.lead.id, now);
          await recordFirstResponse(tx, {
            leadId: conversation.lead.id,
            at: now,
            actor: { userId: principal.userId, roleCode: principal.roleCode },
          });
        }
        return created;
      });
    } catch (error) {
      // A double click: the other request inserted it first.
      if ((error as { code?: unknown }).code === "P2002") {
        const winner = await repository.findByClientRef(null, data.clientRef);
        if (winner) return toMessageView(winner);
      }
      throw error;
    }
    const queue = await getJobQueue();
    await queue.enqueue(sendMessageRef, { messageId: message.id }, { singletonKey: message.id });
    await announce(conversation.id);
    return toMessageView(message);
  }

  function assertCanReply(conversation: ConversationRow) {
    if (conversation.contact.optInStatus === "OPTED_OUT") throw refused(OPTED_OUT);
    if (!windowOf(conversation.lastInboundAt).open) throw refused(WINDOW_CLOSED);
  }

  async function processMessage(eventId: string, event: InboundMessageEvent) {
    const done = () =>
      repository.markEvent(null, eventId, { processedAt: clock.now(), error: null });
    if (event.ignorable) return done();
    const phoneE164 = normalisePhone(`+${event.from}`);
    if (!phoneE164) {
      logger.warn("whatsapp message from an unreadable number", { eventId });
      return repository.markEvent(null, eventId, {
        processedAt: clock.now(),
        error: "unreadable number",
      });
    }
    const occurredAt = parseInstant(event.occurredAt);
    const messageId = randomUUID();
    const { conversationId, inserted, ownerUserId, leadId } = await repository.transaction(
      async (tx) => {
        const { contact, leadId } = await resolveLeadForInbound(tx, {
          phoneE164,
          profileName: event.profileName,
          occurredAt,
        });
        const conversation = await repository.upsertConversation(tx, {
          businessPhoneNumberId: event.phoneNumberId || gateway().businessPhoneNumberId,
          waId: event.from,
          contactId: contact.id,
          leadId,
        });
        const stored = await repository.insertInbound(tx, {
          id: messageId,
          conversationId: conversation.id,
          direction: "INBOUND",
          type: event.type,
          waMessageId: event.waMessageId,
          replyToWaId: event.replyToWaId,
          body: event.body,
          mediaRef: event.mediaId,
          mediaStatus: event.mediaId ? "PENDING" : null,
          mediaMimeType: event.mimeType,
          mediaFilename: event.filename,
          status: "RECEIVED",
          occurredAt,
        });
        if (stored) {
          await repository.recordInboundOnConversation(tx, conversation.id, occurredAt);
          await addLeadTimeline(tx, {
            leadId,
            kind: "MESSAGE",
            summary: "WhatsApp message received",
            refType: "message",
            refId: stored,
            occurredAt,
          });
          await touchLeadActivity(tx, leadId, occurredAt);

          // Decision 58: exact keywords only; a first message opts in; an opt-out stays until START.
          const change = isOptOut(event.body)
            ? { status: "OPTED_OUT" as const, source: "whatsapp_keyword" }
            : isOptIn(event.body)
              ? { status: "OPTED_IN" as const, source: "whatsapp_keyword" }
              : contact.optInStatus === "UNKNOWN"
                ? { status: "OPTED_IN" as const, source: "whatsapp_inbound" }
                : null;
          if (change && change.status !== contact.optInStatus) {
            await setContactOpt(tx, {
              contactId: contact.id,
              ...change,
              at: occurredAt,
              actor: null,
            });
          }
        }
        await repository.markEvent(tx, eventId, { processedAt: clock.now(), error: null });
        const lead = await findLeadOwner(tx, leadId);
        return {
          conversationId: conversation.id,
          inserted: stored,
          ownerUserId: lead?.ownerUserId ?? null,
          leadId,
        };
      },
    );
    if (inserted && event.mediaId) {
      const queue = await getJobQueue();
      await queue.enqueue(downloadMediaRef, { messageId: inserted }, { singletonKey: inserted });
    }
    if (inserted) await announce(conversationId);
    if (inserted && ownerUserId) {
      await notify({
        userIds: [ownerUserId],
        kind: "customer_message",
        key: `message:${inserted}`,
        body: "A customer has written to you on WhatsApp.",
        link: `/leads/${leadId}`,
      });
    }
  }

  async function processStatus(eventId: string, event: StatusEvent) {
    const at = parseInstant(event.occurredAt);
    const conversationId = await repository.transaction(async (tx) => {
      const message = await repository.findMessageByWaId(tx, event.waMessageId);
      if (!message) {
        // Kept, not lost: recordSendResult applies it once the send has saved the provider's ID.
        await repository.markEvent(tx, eventId, { error: "message not known yet" });
        return null;
      }
      if (event.status === "SENT") {
        await repository.advanceStatus(tx, message.id, ["QUEUED"], { status: "SENT" });
      } else if (event.status === "DELIVERED") {
        await repository.advanceStatus(tx, message.id, ["QUEUED", "SENT"], { status: "DELIVERED" });
        await repository.setDeliveredAtIfEmpty(tx, message.id, at);
      } else if (event.status === "READ") {
        await repository.advanceStatus(tx, message.id, ["QUEUED", "SENT", "DELIVERED"], {
          status: "READ",
          readAt: at,
        });
        await repository.setDeliveredAtIfEmpty(tx, message.id, at);
      } else {
        await repository.advanceStatus(tx, message.id, ["QUEUED", "SENT"], {
          status: "FAILED",
          failureCode: event.errorCode ?? "provider_failed",
        });
      }
      await repository.markEvent(tx, eventId, { processedAt: clock.now(), error: null });
      return message.conversationId;
    });
    if (conversationId) await announce(conversationId);
  }

  const service = {
    /** Checks the signature, stores each event once, and queues the work. Returns the HTTP status. */
    async handleWebhook(rawBody: string, headers: Headers): Promise<number> {
      if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) return 413;
      const whatsapp = gateway();
      if (!whatsapp.verifySignature(rawBody, headers)) return 401;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        logger.warn("whatsapp webhook body was not JSON");
        return 200; // retrying can't help
      }
      const events = whatsapp.parseWebhook(parsed);
      if (events.length === 0) {
        logger.info("whatsapp webhook held nothing we use");
        return 200;
      }
      const stored = await repository.storeEvents(
        events.map((event) => ({
          eventKey: event.key,
          kind: event.kind,
          waMessageId: event.kind === "template" ? null : event.waMessageId,
          payload: event as unknown as object,
        })),
      );
      const queue = await getJobQueue();
      for (const row of stored) {
        if (row.processedAt) continue;
        await queue.enqueue(processEventRef, { eventId: row.id }, { singletonKey: row.eventKey });
      }
      return 200;
    },

    async processEvent(eventId: string): Promise<void> {
      const row = await repository.findEvent(eventId);
      if (!row || row.processedAt) return;
      const event = row.payload as unknown as GatewayEvent;
      if (event.kind === "message") return processMessage(row.id, event);
      if (event.kind === "status") return processStatus(row.id, event);
      await repository.transaction(async (tx) => {
        await repository.setTemplateStatus(
          tx,
          event.name,
          event.language,
          event.status,
          event.reason,
        );
        await repository.markEvent(tx, row.id, { processedAt: clock.now(), error: null });
      });
    },

    /** Saves the provider's ID, then applies any status that beat us to it. */
    async recordSendResult(messageId: string, providerMessageId: string): Promise<void> {
      await repository.updateMessage(messageId, { waMessageId: providerMessageId, status: "SENT" });
      for (const { id } of await repository.pendingStatusEvents(providerMessageId)) {
        await service.processEvent(id);
      }
    },

    /** The send job. Retryable provider errors are rethrown so the queue tries again later. */
    async runSend(messageId: string, isFinalAttempt: boolean): Promise<void> {
      const message = await repository.findForSend(messageId);
      if (!message || message.status !== "QUEUED" || message.waMessageId) return;
      const fail = async (failureCode: string) => {
        await repository.updateMessage(messageId, { status: "FAILED", failureCode });
        await announce(message.conversationId);
      };
      const { conversation } = message;
      if (conversation.contact.optInStatus === "OPTED_OUT") return fail("opted_out");
      const whatsapp = gateway();
      const clientRef = message.clientRef ?? message.id;
      try {
        let sent;
        if (message.type === "TEMPLATE") {
          const template = message.templateId
            ? await repository.findTemplate(message.templateId)
            : null;
          if (template?.status !== "APPROVED") return await fail("template_unavailable");
          sent = await whatsapp.sendTemplate({
            to: conversation.waId,
            name: template.name,
            language: template.language,
            variables: (message.templateVariables as string[] | null) ?? [],
            clientRef,
          });
        } else {
          if (!windowOf(conversation.lastInboundAt).open) return await fail("window_closed");
          if (message.mediaRef) {
            const file = await getFileStorage().get(message.mediaRef);
            if (!file) return await fail("file_missing");
            const chunks: Buffer[] = [];
            for await (const chunk of file.body) chunks.push(Buffer.from(chunk as Buffer));
            sent = await whatsapp.sendMedia({
              to: conversation.waId,
              bytes: Buffer.concat(chunks),
              mimeType: message.mediaMimeType ?? "application/octet-stream",
              filename: message.mediaFilename ?? "file",
              caption: message.body,
              clientRef,
            });
          } else {
            sent = await whatsapp.sendText({
              to: conversation.waId,
              body: message.body ?? "",
              clientRef,
            });
          }
        }
        await service.recordSendResult(messageId, sent.providerMessageId);
        await announce(message.conversationId);
      } catch (error) {
        if (error instanceof GatewayError && !error.retryable) return fail(error.code);
        if (isFinalAttempt) await fail(error instanceof GatewayError ? error.code : "send_failed");
        throw error;
      }
    },

    /** Saves a received file. A file we won't keep becomes a placeholder; the message stays. */
    async runDownload(messageId: string, isFinalAttempt: boolean): Promise<void> {
      const message = await repository.findForSend(messageId);
      if (!message || message.mediaStatus !== "PENDING" || !message.mediaRef) return;
      const failed = () => repository.updateMessage(messageId, { mediaStatus: "FAILED" });
      const declaredType = message.mediaMimeType?.split(";")[0].trim() ?? "";
      if (!FILE_TYPES[declaredType]) {
        await failed();
        return announce(message.conversationId);
      }
      try {
        const { bytes } = await gateway().downloadMedia(message.mediaRef);
        if (bytes.byteLength > MAX_RECEIVED_FILE_BYTES) {
          await failed();
          return await announce(message.conversationId);
        }
        const key = buildKey({
          area: "uploads",
          yearMonth: toBusinessDate(clock.now()).slice(0, 7),
          id: messageId,
          extension: FILE_TYPES[declaredType].extension,
        });
        await getFileStorage().put(key, bytes, declaredType);
        await repository.updateMessage(messageId, {
          mediaRef: key,
          mediaStatus: "STORED",
          mediaMimeType: declaredType,
        });
        await announce(message.conversationId);
      } catch (error) {
        if (isFinalAttempt) {
          await failed();
          await announce(message.conversationId);
        }
        throw error;
      }
    },

    async listConversations({ principal }: MessagingContext, input: ListConversationsInput) {
      assertCan(principal, "messaging:view");
      const { page, pageSize, search, unread } = input;
      const digits = search?.replace(/\D/g, "") ?? "";
      const { rows, total } = await repository.listConversations({
        scope: await leadScopeOf(principal),
        skip: (page - 1) * pageSize,
        take: pageSize,
        search,
        phoneDigits: digits.length >= 4 ? digits : undefined,
        unreadOnly: unread === "true",
      });
      return {
        items: rows.map(({ messages, ...row }) => ({
          ...toConversationView(row),
          lastMessage: messages[0] ? toMessageView(messages[0]) : null,
        })),
        total,
        page,
        pageSize,
      };
    },

    async getConversation({ principal }: MessagingContext, id: string) {
      assertCan(principal, "messaging:view");
      const row = await loadConversation(principal, id);
      const messages = await repository.conversationMessages(id, MESSAGE_PAGE + 1);
      return {
        ...toConversationView(row),
        hasOlder: messages.length > MESSAGE_PAGE,
        messages: messages.slice(0, MESSAGE_PAGE).reverse().map(toMessageView),
      };
    },

    /** The page before a message, oldest first, for scrolling back through a long chat. */
    async listOlderMessages({ principal }: MessagingContext, id: string, before?: string) {
      assertCan(principal, "messaging:view");
      await loadConversation(principal, id);
      if (before && !UUID.test(before)) throw notFound();
      const known = before ? await repository.findMessageInConversation(id, before) : true;
      if (!known) throw notFound();
      const messages = await repository.conversationMessages(id, MESSAGE_PAGE + 1, before);
      return {
        hasOlder: messages.length > MESSAGE_PAGE,
        messages: messages.slice(0, MESSAGE_PAGE).reverse().map(toMessageView),
      };
    },

    /** Finds a lead's chat without creating one, so that looking at a lead changes nothing. */
    async findConversationOfLead({ principal }: MessagingContext, leadId: string) {
      assertCan(principal, "messaging:view");
      if (!UUID.test(leadId)) throw notFound();
      const scope = await leadScopeOf(principal);
      const lead = await repository.transaction((tx) => findLeadForChat(tx, leadId, scope));
      if (!lead) throw notFound();
      return { conversationId: await repository.conversationIdOfLead(leadId) };
    },

    async markRead({ principal }: MessagingContext, id: string) {
      assertCan(principal, "messaging:view");
      await loadConversation(principal, id);
      await repository.markRead(id);
      await announce(id);
      return { read: true };
    },

    async sendText(context: MessagingContext, id: string, input: SendTextInput) {
      assertCan(context.principal, "messaging:send");
      const conversation = await loadConversation(context.principal, id);
      assertCanReply(conversation);
      return queueOutbound(context, conversation, {
        clientRef: input.clientRef,
        type: "TEXT",
        body: input.body,
      });
    },

    async sendTemplate(context: MessagingContext, id: string, input: SendTemplateInput) {
      assertCan(context.principal, "messaging:send");
      const conversation = await loadConversation(context.principal, id);
      const { optInStatus } = conversation.contact;
      if (optInStatus === "OPTED_OUT") throw refused(OPTED_OUT);
      if (optInStatus !== "OPTED_IN") {
        throw refused("There's no record that this customer agreed to WhatsApp messages from us.");
      }
      if (!UUID.test(input.templateId)) throw invalid("templateId", "Please choose a template.");
      const template = await repository.findTemplate(input.templateId);
      if (!template) throw invalid("templateId", "Please choose a template.");
      if (template.status !== "APPROVED") throw refused("This template is no longer approved.");
      const needed = templatePlaceholders(template.body).length;
      if (input.variables.length !== needed || input.variables.some((value) => !value)) {
        throw invalid("variables", "Please fill in every detail before sending.");
      }
      return queueOutbound(context, conversation, {
        clientRef: input.clientRef,
        type: "TEMPLATE",
        body: renderTemplate(template.body, input.variables),
        templateName: template.name,
        templateId: template.id,
        templateVariables: input.variables,
      });
    },

    async sendFile(context: MessagingContext, id: string, form: FormData) {
      assertCan(context.principal, "messaging:send");
      const conversation = await loadConversation(context.principal, id);
      assertCanReply(conversation);
      const file = form.get("file");
      const clientRef = String(form.get("clientRef") ?? "");
      const caption = String(form.get("caption") ?? "").trim() || null;
      if (!(file instanceof File) || !clientRef) throw invalid("file", "Please choose a file.");
      const type = FILE_TYPES[file.type];
      if (!type) throw invalid("file", "That type of file can't be sent on WhatsApp.");
      if (file.size > type.sendLimitMb * 1024 * 1024) {
        throw invalid(
          "file",
          `That file is too big. The limit for this type is ${type.sendLimitMb} MB.`,
        );
      }
      const existing = await repository.findByClientRef(null, clientRef);
      if (existing) return toMessageView(existing);
      const messageId = randomUUID();
      const key = buildKey({
        area: "uploads",
        yearMonth: toBusinessDate(clock.now()).slice(0, 7),
        id: messageId,
        extension: type.extension,
      });
      await getFileStorage().put(key, new Uint8Array(await file.arrayBuffer()), file.type);
      return queueOutbound(context, conversation, {
        id: messageId,
        clientRef,
        type: type.kind,
        body: caption,
        mediaRef: key,
        mediaStatus: "STORED",
        mediaMimeType: file.type,
        mediaFilename: file.name.slice(0, 200),
      });
    },

    /** Sends a failed message again. Two clicks queue it once. */
    async retry({ principal }: MessagingContext, messageId: string) {
      assertCan(principal, "messaging:send");
      if (!UUID.test(messageId)) throw notFound();
      const scope = await leadScopeOf(principal);
      const message = await repository.findMessageForAccess(messageId, scope);
      if (!message) throw notFound();
      const conversation = await loadConversation(principal, message.conversationId);
      if (message.type !== "TEMPLATE") assertCanReply(conversation);
      if (await repository.requeueIfFailed(messageId)) {
        const queue = await getJobQueue();
        await queue.enqueue(
          sendMessageRef,
          { messageId },
          { singletonKey: `${messageId}:${randomUUID()}` },
        );
        await announce(message.conversationId);
      }
      return { retried: true };
    },

    /** Staff record that the customer agreed. Never over an opt-out (Decision 58). */
    async recordAgreement({ principal, requestId }: MessagingContext, id: string) {
      assertCan(principal, "messaging:send");
      const conversation = await loadConversation(principal, id);
      if (conversation.contact.optInStatus === "OPTED_OUT") throw refused(OPTED_OUT);
      if (conversation.contact.optInStatus === "OPTED_IN") return { recorded: true };
      await repository.transaction((tx) =>
        setContactOpt(tx, {
          contactId: conversation.contact.id,
          status: "OPTED_IN",
          source: "staff",
          at: clock.now(),
          actor: { userId: principal.userId, roleCode: principal.roleCode },
          requestId,
        }),
      );
      await announce(id);
      return { recorded: true };
    },

    /** The chat for a lead with none yet, such as one added by hand. */
    async startConversation({ principal }: MessagingContext, leadId: string) {
      assertCan(principal, "messaging:view");
      if (!UUID.test(leadId)) throw notFound();
      const scope = await leadScopeOf(principal);
      return repository.transaction(async (tx) => {
        const lead = await findLeadForChat(tx, leadId, scope);
        if (!lead) throw notFound();
        return repository.upsertConversation(tx, {
          businessPhoneNumberId: gateway().businessPhoneNumberId,
          waId: lead.phoneE164.replace(/^\+/, ""),
          contactId: lead.contactId,
          leadId: lead.id,
        });
      });
    },

    /** Streams a stored file to someone who can see its lead. Always a download, never shown inline. */
    async openFile({ principal }: MessagingContext, messageId: string): Promise<Response> {
      assertCan(principal, "messaging:view");
      if (!UUID.test(messageId)) throw notFound();
      const message = await repository.findMessageForAccess(
        messageId,
        await leadScopeOf(principal),
      );
      if (!message || message.mediaStatus !== "STORED" || !message.mediaRef) throw notFound();
      const file = await getFileStorage().get(message.mediaRef);
      if (!file) throw notFound();
      const type =
        message.mediaMimeType && FILE_TYPES[message.mediaMimeType]
          ? message.mediaMimeType
          : "application/octet-stream";
      const name = (
        message.mediaFilename ?? `file.${FILE_TYPES[type]?.extension ?? "bin"}`
      ).replace(/[^\w.\- ]/g, "_");
      return new Response(Readable.toWeb(file.body) as ReadableStream, {
        headers: {
          "content-type": type,
          "content-length": String(file.sizeBytes),
          "content-disposition": `attachment; filename="${name}"`,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    },

    async listTemplates({ principal }: MessagingContext, { approved }: ListTemplatesInput) {
      const manager = can(principal, "messaging:manage-templates");
      return repository.listTemplates(!manager || approved === "true");
    },

    async createTemplate(context: MessagingContext, input: CreateTemplateInput) {
      assertCan(context.principal, "messaging:manage-templates");
      assertPlaceholdersInOrder(input.body);
      const submitted = await gateway().submitTemplate(input);
      try {
        return await repository.transaction(async (tx) => {
          const template = await repository.createTemplate(tx, {
            ...input,
            status: submitted.status,
            providerRef: submitted.providerRef,
          });
          await auditTemplate(tx, context, "template.created", template.id, "Template created");
          return template;
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === "P2002") {
          throw new AppError("CONFLICT", {
            fieldErrors: [
              { field: "name", message: "A template with that name and language already exists." },
            ],
          });
        }
        throw error;
      }
    },

    /** Editing sends it for review again. */
    async updateTemplate(context: MessagingContext, id: string, input: UpdateTemplateInput) {
      assertCan(context.principal, "messaging:manage-templates");
      if (!UUID.test(id)) throw notFound();
      const template = await repository.findTemplate(id);
      if (!template) throw notFound();
      assertPlaceholdersInOrder(input.body);
      const submitted = await gateway().submitTemplate({
        name: template.name,
        language: template.language,
        category: input.category ?? template.category,
        body: input.body,
      });
      return repository.transaction(async (tx) => {
        const updated = await repository.updateTemplate(tx, id, {
          ...input,
          status: submitted.status,
          providerRef: submitted.providerRef,
          rejectedReason: null,
        });
        await auditTemplate(
          tx,
          context,
          "template.updated",
          id,
          "Template changed and resubmitted",
        );
        return updated;
      });
    },

    async deleteTemplate(context: MessagingContext, id: string) {
      assertCan(context.principal, "messaging:manage-templates");
      if (!UUID.test(id)) throw notFound();
      if (!(await repository.findTemplate(id))) throw notFound();
      await repository.transaction(async (tx) => {
        await repository.deleteTemplate(tx, id);
        await auditTemplate(tx, context, "template.deleted", id, "Template deleted");
      });
      return { deleted: true };
    },
  };
  return service;
}

function assertPlaceholdersInOrder(body: string): void {
  const found = templatePlaceholders(body);
  if (found.some((value, index) => value !== index + 1)) {
    throw invalid("body", "Number the details in order: {{1}}, then {{2}}, and so on.");
  }
}

export const messagingService = createMessagingService();
