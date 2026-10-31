// Calling (Decisions 24, 25, 61, 62): placing and answering calls, provider webhooks, inbound routing,
// outcomes and recordings. No provider is named here: everything goes through the adapter. Agents are
// locked before anything else, so one person can never start two calls.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import { peopleOnLeave } from "@/modules/assignment";
import { getUserSummary, listCallers } from "@/modules/identity";
import {
  addLeadTimeline,
  addSystemFollowUp,
  createTaskForLead,
  findLeadForCall,
  findLeadOwner,
  isLeadVisible,
  leadScopeOf,
  normalisePhone,
  resolveLeadForInbound,
  scopeWhere,
  touchLeadActivity,
} from "@/modules/leads";

import { getSetting } from "@/modules/system";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors";
import { getJobQueue } from "@/shared/jobs";
import { logger } from "@/shared/logger";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { publishEvent } from "@/shared/realtime/publish";
import { getFileStorage, buildKey, type FileStorage } from "@/shared/storage";
import {
  businessDateToDbDate,
  businessMoment,
  instantFromEpochMs,
  parseInstant,
  plusDuration,
  systemClock,
  todayBusinessDate,
  type Clock,
} from "@/shared/time";
import { callAlertEvent, callChangedEvent } from "./telephony.events";
import { encryptSecret } from "./telephony.crypto";
import { processEventRef, storeRecordingRef } from "./telephony.jobdefs";
import { getTelephonyProvider } from "./providers/registry.server";
import {
  ProviderError,
  type CallEvent,
  type InboundDecision,
  type TelephonyProvider,
} from "./providers/types";
import { telephonyRepository as repository, type CallRow, type Tx } from "./telephony.repository";
import type {
  EndCallInput,
  EndpointInput,
  ListCallsInput,
  OutcomeInput,
  StartCallInput,
} from "./telephony.schemas";
import { BadRecordingError, transcodeToMp3 } from "./telephony.transcode";
import { CALL_OUTCOMES, isEnded, type CallStatus } from "./telephony.types";

export interface TelephonyContext {
  principal: Principal;
  requestId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HIDDEN_NUMBER = "hidden";
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const PAGE_SIZE = 50;
/** Softphones report in every 30 seconds, so two missed reports mean offline. */
const ONLINE_WINDOW_MS = 75_000;
const RINGING_LIMIT_MS = 5 * 60 * 1000;
const ANSWERED_LIMIT_MS = 6 * 60 * 60 * 1000;
const RECORDING_HELD_MS = 15 * 60 * 1000;
const ROUTING_LIMIT_MS = 3000;
const LINK_SECONDS = 300;
const NO_AGENT_PROMPT =
  "All our team are busy right now. Please leave a message after the tone, and we'll call you back.";

const notFound = () => new AppError("NOT_FOUND");
const root = (message: string) =>
  new AppError("CONFLICT", { fieldErrors: [{ field: "_root", message }] });
const refuse = (message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field: "_root", message }] });

/** Calls only ever move forward through these (P7-CALLHOOK-03). */
const RANK: Record<CallStatus, number> = {
  INITIATED: 0,
  RINGING_AGENT: 1,
  RINGING_CUSTOMER: 1,
  ANSWERED: 2,
  COMPLETED: 3,
  NO_ANSWER: 3,
  BUSY: 3,
  FAILED: 3,
  CANCELLED: 3,
};

const END_LABELS: Partial<Record<CallStatus, string>> = {
  COMPLETED: "Call ended",
  NO_ANSWER: "No answer",
  BUSY: "Line busy",
  FAILED: "Call failed",
  CANCELLED: "Call cancelled",
};

const seconds = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

export const withCompany = (text: string) =>
  text.replaceAll("{company}", APP_CONFIG.company.legalName);

function eventTime(value: string): Date | null {
  try {
    return parseInstant(value);
  } catch {
    return null;
  }
}

function isWithinWorkingHours(at: Date, days: string, from: string, to: string): boolean {
  const { weekday, minute } = businessMoment(at);
  const toMinute = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return (
    days.split(",").map(Number).includes(weekday) &&
    minute >= toMinute(from) &&
    minute < toMinute(to)
  );
}

interface Deps {
  clock?: Clock;
  provider?: () => TelephonyProvider;
  storage?: () => FileStorage;
  /** Off in tests that drive things by hand: no jobs queued, no live notices. */
  enqueue?: boolean;
  routingLimitMs?: number;
  beforeRoutingForTests?: () => Promise<void>;
}

export function createTelephonyService({
  clock = systemClock,
  provider = getTelephonyProvider,
  storage = getFileStorage,
  enqueue = true,
  routingLimitMs = ROUTING_LIMIT_MS,
  beforeRoutingForTests,
}: Deps = {}) {
  const warn = (what: string) => (error: unknown) =>
    logger.warn(`could not ${what}`, { err: error });

  async function announce(call: { id: string; agentUserId: string | null; leadId: string | null }) {
    if (!enqueue) return;
    await publishEvent(callChangedEvent, {
      callId: call.id,
      agentUserId: call.agentUserId ?? "",
      leadId: call.leadId ?? "",
    }).catch(warn("publish a call notice"));
  }

  async function alert(kind: string, call: { id: string; leadId: string | null }) {
    if (!enqueue) return;
    await publishEvent(callAlertEvent, {
      kind,
      callId: call.id,
      leadId: call.leadId ?? "",
    }).catch(warn("publish a call alert"));
  }

  const audit = (
    tx: Tx,
    context: TelephonyContext | null,
    action: AuditAction,
    entityType: string,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType,
      entityId,
      summary,
      actor: context
        ? { userId: context.principal.userId, roleCode: context.principal.roleCode }
        : null,
      requestId: context?.requestId,
      metadata,
    });

  /** The call's end: its timeline entry, and for an inbound call nobody took, the missed-call steps. */
  async function onEnded(
    tx: Tx,
    call: {
      id: string;
      leadId: string | null;
      direction: string;
      agentUserId: string | null;
      answeredAt: Date | null;
      durationSeconds: number | null;
    },
    status: CallStatus,
    at: Date,
  ): Promise<boolean> {
    if (!call.leadId) return call.direction === "INBOUND" && !call.answeredAt;
    const missed = call.direction === "INBOUND" && !call.answeredAt;
    await addLeadTimeline(tx, {
      leadId: call.leadId,
      kind: "CALL",
      summary: missed
        ? "Missed call"
        : `${END_LABELS[status] ?? "Call ended"}${call.durationSeconds ? ` · ${call.durationSeconds} s` : ""}`,
      refType: "call_end",
      refId: call.id,
      // A missed call is nobody's action, so it can't count as a response to the customer.
      actorUserId: missed ? null : call.agentUserId,
      occurredAt: at,
    });
    await touchLeadActivity(tx, call.leadId, at);
    if (missed) {
      const lead = await findLeadOwner(tx, call.leadId);
      if (lead?.ownerUserId) {
        await addSystemFollowUp(tx, {
          leadId: call.leadId,
          assigneeUserId: lead.ownerUserId,
          title: "Call back after a missed call",
          dueDate: businessDateToDbDate(todayBusinessDate(clock)),
          at,
        });
      }
    }
    return missed;
  }

  /** Inside a transaction. Forward only; a late "answered" still fills in the time. */
  async function applyStatus(
    tx: Tx,
    callId: string,
    status: CallStatus,
    at: Date,
    durationSeconds: number | null,
    extra: { providerCallId?: string } = {},
  ) {
    const call = await repository.findCallById(tx, callId);
    if (!call) return { ended: false, missed: false, call: null };
    const data: Parameters<typeof repository.updateCall>[2] = { ...extra };
    const ended = isEnded(status);
    const moving = RANK[status] > RANK[call.status];

    if (status === "ANSWERED" && !call.answeredAt) data.answeredAt = at;
    if (moving) data.status = status;
    const answeredAt = (data.answeredAt as Date | undefined) ?? call.answeredAt;
    if (ended && moving) data.endedAt = at;
    const endedAt = (data.endedAt as Date | undefined) ?? call.endedAt;

    // Works out the length whichever order the events came in.
    if (durationSeconds !== null) {
      data.durationSeconds = durationSeconds;
      data.billableSeconds = durationSeconds;
    } else if (answeredAt && endedAt && call.billableSeconds === null) {
      data.durationSeconds = seconds(answeredAt, endedAt);
      data.billableSeconds = data.durationSeconds;
    } else if (ended && moving && !answeredAt) {
      data.durationSeconds = 0;
    }
    const updated = await repository.updateCall(tx, callId, data);
    const missed = ended && moving ? await onEnded(tx, updated, status, at) : false;
    return { ended: ended && moving, missed, call: updated };
  }

  function view(principal: Principal, row: CallRow) {
    const status = row.recording?.status ?? null;
    return {
      ...row,
      customerName: row.lead?.contact.name ?? null,
      hidden: row.customerPhoneE164 === HIDDEN_NUMBER,
      recordingState: status,
      recording: undefined,
      canPlay: status === "STORED" && can(principal, "telephony:view-recordings"),
    };
  }

  async function loadVisibleCall(principal: Principal, id: string) {
    if (!UUID.test(id)) throw notFound();
    const call = await repository.getCall(id);
    if (!call) throw notFound();
    if (call.agentUserId === principal.userId) return call;
    const scope = await leadScopeOf(principal);
    if (call.leadId ? !(await isLeadVisible(call.leadId, scope)) : scope.kind !== "all") {
      throw notFound();
    }
    return call;
  }

  async function chooseAgent(leadId: string | null) {
    const adapter = provider();
    const now = clock.now();
    const online = new Set(
      await repository.onlineSince(
        adapter.key,
        instantFromEpochMs(now.getTime() - ONLINE_WINDOW_MS),
      ),
    );
    const callers = (await listCallers()).filter((person) => online.has(person.id));
    const ids = callers.map((person) => person.id);
    const [busy, away] = await Promise.all([
      repository.agentsOnCalls(ids),
      peopleOnLeave(ids, now),
    ]);
    const free = ids.filter((id) => !busy.has(id) && !away.has(id));

    const ownerId = leadId
      ? (await repository.transaction((tx) => findLeadOwner(tx, leadId)))?.ownerUserId
      : null;
    if (ownerId && free.includes(ownerId)) return { userId: ownerId, note: "owner" };

    const rule = (await getSetting("telephony.inboundFallback")) as string;
    if (rule === "manager" && ownerId) {
      const managerId = (await getUserSummary(ownerId))?.managerId;
      return managerId && free.includes(managerId)
        ? { userId: managerId, note: "fallback: manager" }
        : null;
    }
    if (free.length === 0) return null;
    // Whoever has gone longest without a call, and anyone who hasn't had one first.
    const last = await repository.lastCallAt(free);
    const next = [...free].sort(
      (a, b) => (last.get(a)?.getTime() ?? 0) - (last.get(b)?.getTime() ?? 0) || a.localeCompare(b),
    )[0];
    return { userId: next, note: "fallback: available agent" };
  }

  async function bothLanguages(
    english: "telephony.outOfHoursMessage" | "telephony.recordingNotice",
  ) {
    const hindi =
      english === "telephony.outOfHoursMessage"
        ? "telephony.outOfHoursMessageHindi"
        : "telephony.recordingNoticeHindi";
    return withCompany(`${await getSetting(english)} ${await getSetting(hindi)}`);
  }

  async function decideInbound(
    request: { providerCallId: string; customerPhone: string | null },
    adapter: TelephonyProvider,
  ): Promise<{ decision: InboundDecision; callId: string }> {
    const now = clock.now();
    const phone = request.customerPhone ? normalisePhone(request.customerPhone) : null;
    const callRef = `in-${request.providerCallId}`;

    const { call, created } = await repository.transaction(async (tx) => {
      const existing = await repository.findCallByRef(tx, callRef);
      if (existing) return { call: existing, created: false };
      const lead = phone
        ? await resolveLeadForInbound(tx, {
            phoneE164: phone,
            profileName: null,
            occurredAt: now,
            source: "PHONE",
          })
        : null;
      const made = await repository.createCall(tx, {
        providerKey: adapter.key,
        providerCallId: request.providerCallId,
        callRef,
        direction: "INBOUND",
        status: "INITIATED",
        leadId: lead?.leadId,
        customerPhoneE164: phone ?? HIDDEN_NUMBER,
        startedAt: now,
      });
      return { call: made, created: true };
    });
    // A repeated request gets the same answer, and rings nobody new.
    if (!created && call.agentUserId) {
      return {
        callId: call.id,
        decision: {
          action: "ring",
          agentUserId: call.agentUserId,
          callRef,
          announcement: await bothLanguages("telephony.recordingNotice"),
        },
      };
    }

    const days = (await getSetting("telephony.workingDays")) as string;
    const from = (await getSetting("telephony.workingFrom")) as string;
    const to = (await getSetting("telephony.workingTo")) as string;
    if (!isWithinWorkingHours(now, days, from, to)) {
      await repository.transaction((tx) =>
        repository.updateCall(tx, call.id, { routingNote: "out of hours" }),
      );
      return {
        callId: call.id,
        decision: {
          action: "voicemail",
          callRef,
          prompt: await bothLanguages("telephony.outOfHoursMessage"),
        },
      };
    }

    const chosen = await chooseAgent(call.leadId);
    if (!chosen) {
      await repository.transaction((tx) =>
        repository.updateCall(tx, call.id, { routingNote: "no agent available" }),
      );
      return {
        callId: call.id,
        decision: { action: "voicemail", callRef, prompt: NO_AGENT_PROMPT },
      };
    }
    const updated = await repository.transaction((tx) =>
      repository.updateCall(tx, call.id, {
        agentUserId: chosen.userId,
        status: "RINGING_AGENT",
        routingNote: chosen.note,
      }),
    );
    await announce(updated);
    return {
      callId: call.id,
      decision: {
        action: "ring",
        agentUserId: chosen.userId,
        callRef,
        announcement: await bothLanguages("telephony.recordingNotice"),
      },
    };
  }

  return {
    /** What the softphone needs: the capabilities, and a short-lived credential for this agent only. */
    async softphone({ principal }: TelephonyContext) {
      assertCan(principal, "telephony:call");
      const adapter = provider();
      const now = clock.now();
      await repository.touchPresence(adapter.key, principal.userId, now);
      const credentials = adapter.capabilities.browserCalling
        ? await adapter.issueAgentCredentials({ userId: principal.userId, now })
        : null;
      const current = await repository.myCurrentCall(principal.userId);
      return {
        providerKey: adapter.key,
        capabilities: adapter.capabilities,
        credentials,
        current: current ? view(principal, current) : null,
      };
    },

    async heartbeat({ principal }: TelephonyContext) {
      assertCan(principal, "telephony:call");
      await repository.touchPresence(provider().key, principal.userId, clock.now());
      return { ok: true };
    },

    async goOffline({ principal }: TelephonyContext) {
      assertCan(principal, "telephony:call");
      await repository.clearPresence(provider().key, principal.userId);
      return { ok: true };
    },

    /** Our record comes first. The same click twice returns the same call. */
    async startCall(context: TelephonyContext, leadId: string, input: StartCallInput) {
      const { principal } = context;
      assertCan(principal, "telephony:call");
      if (!UUID.test(leadId)) throw notFound();
      const adapter = provider();
      const browser = input.channel === "BROWSER";
      if (browser ? !adapter.capabilities.browserCalling : !adapter.capabilities.clickToCall) {
        throw refuse("This way of calling isn't available.");
      }
      const scope = await leadScopeOf(principal);
      const agent = browser ? null : await getUserSummary(principal.userId);
      if (!browser && !agent?.phoneE164) {
        throw refuse(
          "Your profile has no phone number for us to ring. Please ask an Admin to add one.",
        );
      }
      const now = clock.now();

      const { call, repeat } = await repository.transaction(async (tx) => {
        await repository.lock(tx, [`agent:${principal.userId}`]);
        const earlier = await repository.findCallByRef(tx, input.clientRef);
        if (earlier) {
          if (earlier.agentUserId !== principal.userId || earlier.leadId !== leadId)
            throw notFound();
          return { call: earlier, repeat: true };
        }
        const lead = await findLeadForCall(tx, leadId, scope);
        if (!lead) throw notFound();
        const phone = lead.contact.phoneE164;
        if (lead.contact.anonymisedAt || lead.contact.deletedAt || !normalisePhone(phone)) {
          throw refuse("This customer has no number we can call.");
        }
        await repository.lock(tx, [`phone:${phone}`]);
        if (await repository.findActiveForAgent(tx, principal.userId)) {
          throw root("You're already on a call. Please finish it first.");
        }
        if (await repository.findActiveForPhone(tx, phone)) {
          throw root("This customer is already on a call with us.");
        }
        const made = await repository.createCall(tx, {
          providerKey: adapter.key,
          callRef: input.clientRef,
          channel: input.channel,
          status: "INITIATED",
          leadId,
          agentUserId: principal.userId,
          customerPhoneE164: phone,
          startedAt: now,
        });
        // A call is a response to the customer, however it turns out.
        await addLeadTimeline(tx, {
          leadId,
          kind: "CALL",
          summary: "Outgoing call started",
          refType: "call_start",
          refId: made.id,
          actorUserId: principal.userId,
          occurredAt: now,
        });
        await touchLeadActivity(tx, leadId, now);
        return { call: made, repeat: false };
      });

      if (!repeat && !browser) {
        try {
          const providerCallId = await adapter.placeCall({
            callRef: call.callRef,
            agentPhone: agent?.phoneE164 as string,
            customerPhone: call.customerPhoneE164,
          });
          await repository.transaction((tx) =>
            repository.updateCall(tx, call.id, { providerCallId, status: "RINGING_AGENT" }),
          );
        } catch (error) {
          logger.warn("the calling provider refused a call", { err: error, callId: call.id });
          await repository.transaction((tx) =>
            applyStatus(tx, call.id, "FAILED", clock.now(), null),
          );
          throw root("We couldn't reach the calling service. Please try again in a moment.");
        }
      }
      await announce(call);
      const row = await repository.getCall(call.id);
      return view(principal, row as CallRow);
    },

    /** What the agent's browser knows: they gave up, it failed, or they hung up. */
    async endCall({ principal }: TelephonyContext, id: string, { reason }: EndCallInput) {
      assertCan(principal, "telephony:call");
      const call = await loadVisibleCall(principal, id);
      if (call.agentUserId !== principal.userId) throw notFound();
      const status: CallStatus =
        reason === "failed"
          ? "FAILED"
          : call.status === "ANSWERED"
            ? "COMPLETED"
            : reason === "hangup" && call.direction === "INBOUND"
              ? "NO_ANSWER"
              : "CANCELLED";
      const result = await repository.transaction((tx) =>
        applyStatus(tx, id, status, clock.now(), null),
      );
      if (result.call) await announce(result.call);
      if (result.missed)
        await alert("missed", result.call as { id: string; leadId: string | null });
      const row = await repository.getCall(id);
      return view(principal, row as CallRow);
    },

    /** Only one person can answer a ringing call. */
    async answer({ principal }: TelephonyContext, id: string) {
      assertCan(principal, "telephony:call");
      if (!UUID.test(id)) throw notFound();
      const at = clock.now();
      const call = await repository.transaction(async (tx) => {
        const answered = await repository.markAnswered(tx, id, principal.userId, at);
        if (!answered) throw root("This call has already been answered or has ended.");
        return repository.findCallById(tx, id);
      });
      if (call) await announce(call);
      const row = await repository.getCall(id);
      return view(principal, row as CallRow);
    },

    async decline({ principal }: TelephonyContext, id: string) {
      assertCan(principal, "telephony:call");
      if (!UUID.test(id)) throw notFound();
      const result = await repository.transaction(async (tx) => {
        const call = await repository.findCallById(tx, id);
        if (call?.agentUserId !== principal.userId) throw notFound();
        return applyStatus(tx, id, "NO_ANSWER", clock.now(), null);
      });
      if (result.call) await announce(result.call);
      if (result.missed)
        await alert("missed", result.call as { id: string; leadId: string | null });
      return { declined: true };
    },

    /** Can be filled in later, and only once: a second click with the same answer changes nothing. */
    async saveOutcome(context: TelephonyContext, id: string, input: OutcomeInput) {
      const { principal } = context;
      assertCan(principal, "telephony:call");
      const call = await loadVisibleCall(principal, id);
      if (!isEnded(call.status)) throw root("You can log the outcome once the call has ended.");
      if (call.outcomeCode) {
        if (call.outcomeCode === input.outcome) return view(principal, call);
        throw root("The outcome of this call has already been logged.");
      }
      const at = clock.now();
      const saved = await repository.transaction(async (tx) => {
        const first = await repository.setOutcome(tx, id, input.outcome, input.notes ?? null);
        if (!first) return false;
        if (call.leadId) {
          await addLeadTimeline(tx, {
            leadId: call.leadId,
            kind: "CALL",
            summary: `Outcome: ${CALL_OUTCOMES[input.outcome]}${input.notes ? ` — ${input.notes}` : ""}`,
            refType: "call_outcome",
            refId: id,
            actorUserId: principal.userId,
            occurredAt: at,
          });
          await touchLeadActivity(tx, call.leadId, at);
        }
        await audit(tx, context, "telephony.outcome_saved", "call", id, "Call outcome saved", {
          outcome: input.outcome,
        });
        return true;
      });
      if (!saved) {
        const winner = await repository.getCall(id);
        if (winner?.outcomeCode !== input.outcome) {
          throw root("The outcome of this call has already been logged.");
        }
      }
      if (saved && call.leadId && input.followUpDate) {
        await createTaskForLead(context, call.leadId, {
          title: input.followUpTitle || `Follow up: ${CALL_OUTCOMES[input.outcome]}`,
          dueDate: input.followUpDate,
        });
      }
      const row = await repository.getCall(id);
      return view(principal, row as CallRow);
    },

    async listLeadCalls({ principal }: TelephonyContext, leadId: string) {
      if (!UUID.test(leadId)) throw notFound();
      const scope = await leadScopeOf(principal);
      if (!(await isLeadVisible(leadId, scope))) throw notFound();
      const calls = await repository.listForLead(leadId);
      return { items: calls.map((call) => view(principal, call)) };
    },

    async listCalls({ principal }: TelephonyContext, input: ListCallsInput) {
      assertCan(principal, "telephony:call");
      const scope = await leadScopeOf(principal);
      const where = {
        ...(input.filter === "missed"
          ? {
              direction: "INBOUND" as const,
              answeredAt: null,
              status: { in: ["NO_ANSWER" as const, "CANCELLED" as const, "FAILED" as const] },
            }
          : {}),
        ...(scope.kind === "all"
          ? {}
          : {
              OR: [
                { agentUserId: principal.userId },
                { lead: { deletedAt: null, ...scopeWhere(scope) } },
              ],
            }),
      };
      const [items, total] = await repository.listCalls(
        where,
        (input.page - 1) * PAGE_SIZE,
        PAGE_SIZE,
      );
      return {
        items: items.map((call) => view(principal, call)),
        total,
        page: input.page,
        pageSize: PAGE_SIZE,
      };
    },

    async currentCall({ principal }: TelephonyContext) {
      assertCan(principal, "telephony:call");
      const call = await repository.myCurrentCall(principal.userId);
      return { current: call ? view(principal, call) : null };
    },

    async getCall({ principal }: TelephonyContext, id: string) {
      return view(principal, await loadVisibleCall(principal, id));
    },

    // Webhooks

    async handleWebhook(rawBody: string, headers: Headers): Promise<number> {
      if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) return 413;
      const adapter = provider();
      if (!adapter.verifyWebhook(rawBody, headers)) return 401;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        logger.warn("calling webhook body was not JSON");
        return 200;
      }
      const queue = enqueue ? await getJobQueue() : null;
      for (const event of adapter.parseWebhook(parsed)) {
        const row = await repository.storeEvent(adapter.key, event.key, event as unknown as object);
        if (row.processedAt) continue;
        await queue?.enqueue(processEventRef, { eventId: row.id }, { singletonKey: row.id });
      }
      return 200;
    },

    /** Idempotent: an event already processed does nothing more. */
    async processEvent(eventId: string): Promise<void> {
      const adapter = provider();
      const after: Array<() => Promise<unknown>> = [];
      await repository.transaction(async (tx) => {
        const row = await repository.findEvent(tx, eventId);
        if (!row || row.processedAt) return;
        const event = row.payload as unknown as CallEvent;
        const now = clock.now();
        const at = eventTime(event.occurredAt) ?? now;

        const phone =
          event.kind === "status" && event.customerPhone
            ? normalisePhone(event.customerPhone)
            : null;
        const call =
          (event.callRef ? await repository.findCallByRef(tx, event.callRef) : null) ??
          (await repository.findCallByProviderId(tx, adapter.key, event.providerCallId)) ??
          (phone ? await repository.findUnmatchedCallByPhone(tx, phone) : null);
        if (!call) {
          logger.warn("calling event matched no call", { eventId });
          await repository.markEventDone(tx, eventId, now, "no matching call");
          return;
        }
        await repository.lock(tx, [`call:${call.id}`]);

        if (event.kind === "recording") {
          await repository.noteRecordingReady(tx, call.id, event.recordingRef, at);
          after.push(async () => {
            if (!enqueue) return;
            const queue = await getJobQueue();
            await queue.enqueue(storeRecordingRef, { callId: call.id }, { singletonKey: call.id });
          });
          await repository.markEventDone(tx, eventId, now, null);
          return;
        }
        if (!event.status) {
          logger.warn("calling event had an unknown status", { eventId, status: event.rawStatus });
          await repository.markEventDone(tx, eventId, now, "unknown status");
          return;
        }
        const result = await applyStatus(tx, call.id, event.status, at, event.durationSeconds, {
          ...(call.providerCallId ? {} : { providerCallId: event.providerCallId }),
        });
        await repository.markEventDone(tx, eventId, now, null);
        if (result.call) after.push(() => announce(result.call));
        if (result.missed) after.push(() => alert("missed", call));
      });
      for (const work of after) await work().catch(warn("finish after a calling event"));
    },

    /** Answers the provider quickly: if deciding takes too long, the caller still gets a message. */
    async routeInbound(rawBody: string, headers: Headers): Promise<Response> {
      const adapter = provider();
      if (!adapter.verifyWebhook(rawBody, headers)) return new Response("", { status: 401 });
      let request: ReturnType<TelephonyProvider["parseInboundRequest"]> = null;
      try {
        request = adapter.parseInboundRequest(JSON.parse(rawBody));
      } catch {
        logger.warn("inbound call request was not JSON");
      }
      if (!request) return new Response("", { status: 200 });
      const incoming = request;
      const decided = (async () => {
        await beforeRoutingForTests?.();
        return decideInbound(incoming, adapter);
      })();
      const tooSlow = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), routingLimitMs);
      });
      const result = await Promise.race([decided.catch(() => null), tooSlow]);
      if (result) return adapter.answerInboundRouting(result.decision);
      logger.warn("inbound routing was too slow or failed");
      // Whatever the late decision was, nobody will be ringing now: don't show a pop-up for it.
      void decided
        .then((late) =>
          repository.transaction((tx) =>
            applyStatus(tx, late.callId, "NO_ANSWER", clock.now(), null),
          ),
        )
        .catch(warn("close a call whose routing was too slow"));
      return adapter.answerInboundRouting({
        action: "voicemail",
        callRef: null,
        prompt: NO_AGENT_PROMPT,
      });
    },

    // Recordings

    /** Safe to run again at any point: nothing is recorded as stored until the file is safely in place. */
    async storeRecording(callId: string, finalAttempt: boolean): Promise<void> {
      const now = clock.now();
      const held = instantFromEpochMs(now.getTime() - RECORDING_HELD_MS);
      if (!(await repository.claimRecording(callId, held))) return;
      const recording = await repository.findRecording(callId);
      if (!recording?.providerRecordingRef) return;
      const call = await repository.transaction((tx) => repository.findCallById(tx, callId));
      const fail = async (error: unknown, permanent: boolean) => {
        const message = error instanceof Error ? error.message : "failed";
        if (permanent || finalAttempt) {
          await repository.updateRecording(callId, { status: "FAILED", lastError: message });
          await alert("recording_failed", { id: callId, leadId: call?.leadId ?? null });
          return;
        }
        await repository.updateRecording(callId, { status: "PENDING", lastError: message });
        throw error;
      };
      try {
        const source = await provider().fetchRecording(recording.providerRecordingRef);
        const bitrate = (await getSetting("recording.bitrateKbps")) as number;
        const days = (await getSetting("retention.recordingDays")) as number;
        const key = buildKey({
          area: "recordings",
          yearMonth: businessMoment(now).date.slice(0, 7),
          id: callId,
          extension: "mp3",
        });
        const stored = await transcodeToMp3(source, bitrate, async (path, sizeBytes) => {
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
          const expected = hash.digest("hex");
          const file = await storage().put(key, createReadStream(path), "audio/mpeg");
          if (file.checksumSha256 !== expected || file.sizeBytes !== sizeBytes) {
            await storage().delete(key);
            throw new Error("the stored file doesn't match what was sent");
          }
          return file;
        });
        await repository.updateRecording(callId, {
          status: "STORED",
          storageKey: key,
          contentType: "audio/mpeg",
          sizeBytes: stored.sizeBytes,
          durationSeconds: call?.durationSeconds,
          checksumSha256: stored.checksumSha256,
          storedAt: now,
          expiresAt: plusDuration(now, { days }),
          lastError: null,
        });
        if (call) await announce(call);
      } catch (error) {
        const permanent =
          error instanceof BadRecordingError || (error instanceof ProviderError && error.permanent);
        await fail(error, permanent);
      }
    },

    async retryRecording({ principal }: TelephonyContext, id: string) {
      assertCan(principal, "telephony:view-recordings");
      await loadVisibleCall(principal, id);
      const recording = await repository.findRecording(id);
      if (recording?.status !== "FAILED") throw root("This recording isn't waiting for a retry.");
      if (enqueue) {
        const queue = await getJobQueue();
        await queue.enqueue(
          storeRecordingRef,
          { callId: id },
          { singletonKey: `retry-${id}-${recording.attempts}` },
        );
      }
      return { queued: true };
    },

    /** Needs the permission and the scope, whatever link is used. Each playback is audited. */
    async playRecording(context: TelephonyContext, id: string, rangeHeader: string | null) {
      const { principal } = context;
      assertCan(principal, "telephony:view-recordings");
      await loadVisibleCall(principal, id);
      const recording = await repository.findRecording(id);
      if (recording?.status !== "STORED" || !recording.storageKey) throw notFound();
      const key = recording.storageKey;
      const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? "");
      // Seeking sends more requests for one listen: only the start counts as a playback.
      if (!range || range[1] === "0") {
        await repository.transaction((tx) =>
          audit(tx, context, "telephony.recording_played", "call", id, "Call recording played"),
        );
      }
      const link = await storage().getTemporaryUrl(key, LINK_SECONDS);
      if (link) return new Response(null, { status: 302, headers: { location: link } });

      const file = await storage().get(key);
      if (!file) throw notFound();
      const parts: Buffer[] = [];
      for await (const chunk of file.body) parts.push(Buffer.from(chunk as Uint8Array));
      const all = Buffer.concat(parts);
      const headers: Record<string, string> = {
        "content-type": recording.contentType ?? "audio/mpeg",
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
      };
      if (!range) {
        return new Response(all, { headers: { ...headers, "content-length": String(all.length) } });
      }
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : all.length - 1, all.length - 1);
      if (start > end) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${all.length}` },
        });
      }
      return new Response(all.subarray(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${start}-${end}/${all.length}`,
          "content-length": String(end - start + 1),
        },
      });
    },

    /** Deletes the files and keeps the call log. A file already gone is fine; a repeat finds nothing. */
    async deleteExpiredRecordings(): Promise<number> {
      const now = clock.now();
      let deleted = 0;
      for (const row of await repository.expiredRecordings(now, 500)) {
        if (row.storageKey) await storage().delete(row.storageKey);
        await repository.updateRecording(row.callId, {
          status: "DELETED",
          storageKey: null,
          deletedAt: now,
        });
        deleted += 1;
      }
      if (deleted > 0) {
        await repository.transaction((tx) =>
          audit(
            tx,
            null,
            "telephony.recording_deleted",
            "recordings",
            "retention",
            "Expired recordings deleted",
            {
              count: deleted,
            },
          ),
        );
      }
      return deleted;
    },

    /** Every minute: closes calls that never got an end event, with a clear status. */
    async sweep(): Promise<void> {
      const now = clock.now().getTime();
      const stale = await repository.staleCalls(
        instantFromEpochMs(now - RINGING_LIMIT_MS),
        instantFromEpochMs(now - ANSWERED_LIMIT_MS),
      );
      for (const { id } of stale) {
        const result = await repository.transaction(async (tx) => {
          const applied = await applyStatus(tx, id, "FAILED", clock.now(), null);
          if (applied.ended) {
            await repository.updateCall(tx, id, { routingNote: "closed: no end event arrived" });
          }
          return applied;
        });
        if (result.call) await announce(result.call);
        if (result.missed)
          await alert("missed", result.call as { id: string; leadId: string | null });
      }
    },

    // Fixed logins, for providers that need them

    /** Encrypted, and never returned. */
    async saveEndpoint(context: TelephonyContext, userId: string, input: EndpointInput) {
      assertCan(context.principal, "users:edit");
      if (!UUID.test(userId) || !(await getUserSummary(userId))) throw notFound();
      await repository.transaction(async (tx) => {
        await repository.saveEndpoint(tx, provider().key, userId, {
          loginEncrypted: encryptSecret(input.login),
          secretEncrypted: input.secret ? encryptSecret(input.secret) : null,
        });
        await audit(
          tx,
          context,
          "telephony.endpoint_changed",
          "user",
          userId,
          "Calling login changed",
        );
      });
      return { saved: true };
    },
  };
}

export const telephonyService = createTelephonyService();
