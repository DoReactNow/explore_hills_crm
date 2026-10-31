"use client";

// The softphone lives here, above every page, so a call carries on while the agent moves around. The
// call's state always comes from the server; the provider's kit only says something may have changed.
// Times come from timestamps, so the timer stays right after a tab has slept (P7-CALLLIVE-08).
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { parseInstant, systemClock } from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { softphoneFor } from "../providers/registry.browser";
import type { SoftphoneClient, SoftphoneErrorKind } from "../providers/softphone";
import {
  CALL_OUTCOMES,
  isEnded,
  type CallOutcome,
  type CallStatus,
  type Capabilities,
} from "../telephony.types";
import styles from "./telephony.module.css";

const NOTICES = ["telephony.callChanged", "telephony.alert"];
const HEARTBEAT_MS = 30_000;
const RENEW_BEFORE_MS = 60_000;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export interface CallView {
  id: string;
  callRef: string;
  direction: "INBOUND" | "OUTBOUND";
  status: CallStatus;
  leadId: string | null;
  customerName: string | null;
  customerPhoneE164: string;
  hidden: boolean;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  outcomeCode: string | null;
  outcomeNotes: string | null;
  recordingState: string | null;
  canPlay: boolean;
  agent: { id: string; name: string } | null;
}

interface SoftphoneState {
  available: boolean;
  capabilities: Capabilities | null;
  problem: SoftphoneErrorKind | null;
  current: CallView | null;
  /** Bumps when any call changes, so lists can re-read. */
  version: number;
  error: FriendlyError | null;
  start(leadId: string, channel: "BROWSER" | "PHONE"): Promise<void>;
  retryConnection(): void;
  logOutcomeFor(call: CallView): void;
}

const Context = createContext<SoftphoneState>({
  available: false,
  capabilities: null,
  problem: null,
  current: null,
  version: 0,
  error: null,
  start: async () => undefined,
  retryConnection: () => undefined,
  logOutcomeFor: () => undefined,
});
export const useSoftphone = () => useContext(Context);

const nameOf = (call: CallView) =>
  call.customerName ?? (call.hidden ? "Hidden number" : call.customerPhoneE164);
const clockOf = (from: string | null, now: number) => {
  if (!from) return "";
  const total = Math.max(0, Math.floor((now - parseInstant(from).getTime()) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
};
const STATUS_LABELS: Partial<Record<CallStatus, string>> = {
  INITIATED: "Dialling…",
  RINGING_CUSTOMER: "Ringing on the customer's phone",
  RINGING_AGENT: "Ringing",
  ANSWERED: "Connected",
};

function OutcomeDialog({ call, onClose }: { call: CallView; onClose: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  async function save() {
    setBusy(true);
    const result = await apiRequest(`/api/telephony/calls/${call.id}/outcome`, {
      method: "POST",
      body: {
        outcome,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(followUpDate ? { followUpDate } : {}),
      },
    });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  }

  return (
    <Dialog title="How did the call go?" onClose={onClose}>
      <span className={styles.muted}>{nameOf(call)}</span>
      {error ? <ErrorMessage error={error} /> : null}
      <div role="group" aria-label="Outcome" className={styles.pills}>
        {(Object.keys(CALL_OUTCOMES) as CallOutcome[]).map((key) => (
          <button
            key={key}
            type="button"
            className={styles.pill}
            aria-pressed={outcome === key}
            onClick={() => setOutcome(key)}
          >
            {CALL_OUTCOMES[key]}
          </button>
        ))}
      </div>
      <label className={styles.field}>
        Notes
        <textarea
          className={styles.input}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        Next follow-up
        <input
          className={styles.input}
          type="date"
          value={followUpDate}
          onChange={(event) => setFollowUpDate(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onClose}>
          Skip for now
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!outcome || busy}
          onClick={save}
        >
          Save outcome
        </button>
      </div>
    </Dialog>
  );
}

export function CallCard({ call }: { call: CallView }) {
  const { client } = useContext(ClientContext);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [tones, setTones] = useState("");
  const [now, setNow] = useState(() => systemClock.now().getTime());
  const [refused, setRefused] = useState(false);
  const connected = call.status === "ANSWERED";

  useEffect(() => {
    const timer = setInterval(() => setNow(systemClock.now().getTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function attempt(work: () => Promise<void> | undefined, then: () => void) {
    try {
      await work();
      setRefused(false);
      then();
    } catch {
      setRefused(true);
    }
  }

  return (
    <section aria-label="Current call" className={styles.card}>
      <div className={styles.cardTop}>
        <span
          className={`${styles.dot} ${connected ? styles.dotLive : call.status === "INITIATED" ? "" : styles.dotRing}`}
        />
        <span role="status">{held ? "On hold" : (STATUS_LABELS[call.status] ?? "Call")}</span>
        <span className={styles.timer}>{clockOf(call.answeredAt, now)}</span>
      </div>
      <span className={styles.who}>{nameOf(call)}</span>
      {refused ? <span>That didn&apos;t work on this call. Please try again.</span> : null}
      {keypad && connected ? (
        <div>
          <div aria-label="Tones sent">{tones}</div>
          <div className={styles.keypad}>
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.control}
                onClick={() =>
                  attempt(
                    () => client?.sendDtmf(key),
                    () => setTones((sent) => sent + key),
                  )
                }
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.control}
          disabled={!connected}
          aria-pressed={muted}
          onClick={() =>
            attempt(
              () => client?.mute(!muted),
              () => setMuted(!muted),
            )
          }
        >
          Mute
        </button>
        <button
          type="button"
          className={styles.control}
          disabled={!connected}
          aria-pressed={held}
          onClick={() =>
            attempt(
              () => client?.hold(!held),
              () => setHeld(!held),
            )
          }
        >
          Hold
        </button>
        <button
          type="button"
          className={styles.control}
          disabled={!connected}
          aria-pressed={keypad}
          onClick={() => setKeypad(!keypad)}
        >
          Keypad
        </button>
        <button
          type="button"
          className={`${styles.control} ${styles.danger}`}
          onClick={() => endCallFrom(client, call)}
        >
          {connected ? "Hang up" : "Cancel"}
        </button>
      </div>
    </section>
  );
}

/** The browser kit ends the audio; our record is told too, in case no event ever arrives. */
function endCallFrom(client: SoftphoneClient | null, call: CallView) {
  void client?.hangup();
  void apiRequest(`/api/telephony/calls/${call.id}/end`, {
    method: "POST",
    body: { reason: call.status === "ANSWERED" ? "hangup" : "cancelled" },
  });
}

const ClientContext = createContext<{ client: SoftphoneClient | null }>({ client: null });

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const { can } = usePrincipal();
  const allowed = can("telephony:call");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [current, setCurrent] = useState<CallView | null>(null);
  const [problem, setProblem] = useState<SoftphoneErrorKind | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<CallView | null>(null);
  const [alertText, setAlertText] = useState("");
  const [client, setClient] = useState<SoftphoneClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => systemClock.now().getTime());
  const currentRef = useRef<CallView | null>(null);
  const clientRef = useRef<SoftphoneClient | null>(null);

  const refresh = useCallback(async () => {
    const result = await apiRequest<{ current: CallView | null }>("/api/telephony/current");
    if (!result.ok) return;
    const next = result.data.current;
    const before = currentRef.current;
    if (before && !next) {
      // The call has just ended here: read how it finished, and ask how it went.
      const ended = await apiRequest<CallView>(`/api/telephony/calls/${before.id}`);
      if (ended.ok && isEnded(ended.data.status) && before.status === "ANSWERED") {
        setOutcomeFor(ended.data);
      }
    }
    currentRef.current = next;
    setCurrent(next);
    setVersion((n) => n + 1);
  }, []);

  useLiveEvents({
    types: allowed ? NOTICES : [],
    onEvent: (type, payload) => {
      if (type === "telephony.alert") {
        const kind = (payload as { kind?: string }).kind;
        setAlertText(
          kind === "missed"
            ? "A customer's call was missed. See Calls for the details."
            : "A call recording couldn't be saved. The call itself was logged.",
        );
      }
      void refresh();
    },
    onResync: () => void refresh(),
  });

  useEffect(() => {
    if (!allowed) return;
    let stopped = false;
    let made: SoftphoneClient | null = null;
    let renew: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      const result = await apiRequest<{
        providerKey: string;
        capabilities: Capabilities;
        credentials: { token: string; expiresAt: string } | null;
        current: CallView | null;
      }>("/api/telephony/softphone");
      if (stopped) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCapabilities(result.data.capabilities);
      currentRef.current = result.data.current;
      setCurrent(result.data.current);
      const factory = softphoneFor(result.data.providerKey);
      if (!factory || !result.data.credentials) return;
      made ??= factory({
        ringing: () => void refresh(),
        connected: () => void refresh(),
        ended: () => void refresh(),
        error: (kind) => setProblem(kind),
        connectionLost: () => setProblem("connection_lost"),
      });
      clientRef.current = made;
      setClient(made);
      setProblem(null);
      await made.connect(result.data.credentials).catch(() => setProblem("failed"));
      // Renews before it runs out; a failure above tells the agent plainly (P7-CALL-07).
      const left =
        parseInstant(result.data.credentials.expiresAt).getTime() - systemClock.now().getTime();
      renew = setTimeout(connect, Math.max(left - RENEW_BEFORE_MS, 5000));
    }
    void connect();
    const beat = setInterval(() => {
      void apiRequest("/api/telephony/heartbeat", { method: "POST" });
    }, HEARTBEAT_MS);

    // Closing or refreshing the tab ends the audio, so the call ends with it (Decision 62).
    const onLeave = () => {
      const active = currentRef.current;
      void fetch("/api/telephony/offline", { method: "POST", keepalive: true });
      if (active) {
        void fetch(`/api/telephony/calls/${active.id}/end`, {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: active.status === "ANSWERED" ? "hangup" : "cancelled" }),
        });
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      stopped = true;
      clearTimeout(renew);
      clearInterval(beat);
      window.removeEventListener("pagehide", onLeave);
      made?.disconnect();
    };
  }, [allowed, attempt, refresh]);

  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => setNow(systemClock.now().getTime()), 1000);
    return () => clearInterval(timer);
  }, [current]);

  const start = useCallback(
    async (leadId: string, channel: "BROWSER" | "PHONE") => {
      setError(null);
      const result = await apiRequest<CallView>(`/api/leads/${leadId}/calls`, {
        method: "POST",
        body: { clientRef: crypto.randomUUID(), channel },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      currentRef.current = result.data;
      setCurrent(result.data);
      setVersion((n) => n + 1);
      if (channel === "BROWSER") {
        await clientRef.current
          ?.dial(result.data.callRef, result.data.customerPhoneE164)
          .catch(async () => {
            setProblem("failed");
            await apiRequest(`/api/telephony/calls/${result.data.id}/end`, {
              method: "POST",
              body: { reason: "failed" },
            });
            void refresh();
          });
      }
    },
    [refresh],
  );

  const value = useMemo<SoftphoneState>(
    () => ({
      available: allowed,
      capabilities,
      problem,
      current,
      version,
      error,
      start,
      retryConnection: () => setAttempt((n) => n + 1),
      logOutcomeFor: setOutcomeFor,
    }),
    [allowed, capabilities, problem, current, version, error, start],
  );

  const ringing =
    current?.direction === "INBOUND" && current.status === "RINGING_AGENT" ? current : null;

  async function answer(call: CallView) {
    const result = await apiRequest(`/api/telephony/calls/${call.id}/answer`, { method: "POST" });
    if (!result.ok) {
      setError(result.error);
      void refresh();
      return;
    }
    await clientRef.current?.answer(call.id);
    void refresh();
  }
  async function decline(call: CallView) {
    await apiRequest(`/api/telephony/calls/${call.id}/decline`, { method: "POST" });
    void refresh();
  }

  return (
    <Context.Provider value={value}>
      <ClientContext.Provider value={{ client }}>
        {current && !ringing ? (
          <Link
            href={current.leadId ? `/leads/${current.leadId}` : "/calls"}
            className={styles.bar}
          >
            <span
              className={`${styles.dot} ${current.status === "ANSWERED" ? styles.dotLive : styles.dotRing}`}
            />
            <span>On a call · {nameOf(current)}</span>
            <span className={styles.barEnd}>{clockOf(current.answeredAt, now)}</span>
          </Link>
        ) : null}
        {alertText ? (
          <div role="alert" className={styles.notice}>
            {alertText}{" "}
            <Link href="/calls?filter=missed" onClick={() => setAlertText("")}>
              Open calls
            </Link>
          </div>
        ) : null}
        {children}
        {ringing ? (
          <div
            role="alertdialog"
            aria-label={`Incoming call from ${nameOf(ringing)}`}
            className={`${styles.card} ${styles.popup}`}
          >
            <div className={styles.cardTop}>Incoming call · ringing</div>
            <span className={styles.who}>{nameOf(ringing)}</span>
            {ringing.leadId ? (
              <Link className={styles.detail} href={`/leads/${ringing.leadId}`}>
                Open the lead
              </Link>
            ) : null}
            <div className={styles.controls}>
              <button type="button" className={styles.decline} onClick={() => decline(ringing)}>
                Decline
              </button>
              <button type="button" className={styles.answer} onClick={() => answer(ringing)}>
                Answer
              </button>
            </div>
          </div>
        ) : null}
        {outcomeFor ? (
          <OutcomeDialog
            call={outcomeFor}
            onClose={() => {
              setOutcomeFor(null);
              setVersion((n) => n + 1);
            }}
          />
        ) : null}
      </ClientContext.Provider>
    </Context.Provider>
  );
}
