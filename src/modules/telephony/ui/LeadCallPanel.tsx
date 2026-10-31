"use client";

// Calling from a lead: the Call button, the live card, softphone problems, and the call history with
// its recordings. Features the provider can't do are left out (P7-DRIVER-03).
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { CALL_OUTCOMES, isEnded, type CallOutcome } from "../telephony.types";
import { CallCard, useSoftphone, type CallView } from "./SoftphoneProvider";
import styles from "./telephony.module.css";

const PROBLEMS = {
  mic_denied:
    "Your microphone is blocked. Click the lock icon next to the web address, set Microphone to Allow, then try again.",
  no_mic: "We can't find a microphone. Please plug in your headset, then try again.",
  connection_lost: "Connection lost. We're reconnecting your calling line.",
  refused: "The calling service refused that. Please try again.",
  failed: "We couldn't connect your calling line.",
};
const ENDED_LABELS: Record<string, string> = {
  COMPLETED: "Ended",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function RecordingState({ call }: { call: CallView }) {
  const { can } = usePrincipal();
  const [retried, setRetried] = useState(false);
  if (!call.recordingState) {
    return isEnded(call.status) && call.answeredAt ? (
      <span className={styles.muted}>No recording for this call.</span>
    ) : null;
  }
  if (call.recordingState === "STORED") {
    return call.canPlay ? (
      <audio
        className={styles.audio}
        controls
        preload="none"
        src={`/api/telephony/calls/${call.id}/recording`}
        aria-label="Call recording"
      />
    ) : (
      <div className={styles.state}>Recordings for this lead are visible to managers only.</div>
    );
  }
  if (call.recordingState === "DELETED") {
    return (
      <div className={styles.state}>
        This recording is no longer available. It was removed under your company&apos;s retention
        settings.
      </div>
    );
  }
  if (call.recordingState === "FAILED") {
    return (
      <div className={`${styles.state} ${styles.stateBad}`}>
        We couldn&apos;t save this recording. The call itself was logged.{" "}
        {can("telephony:view-recordings") && !retried ? (
          <button
            type="button"
            className={styles.button}
            onClick={async () => {
              await apiRequest(`/api/telephony/calls/${call.id}/recording/retry`, {
                method: "POST",
              });
              setRetried(true);
            }}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles.state}>
      Recording is being prepared. It usually takes about a minute after the call ends.
    </div>
  );
}

export function LeadCallPanel({ leadId }: { leadId: string }) {
  const phone = useSoftphone();
  const [calls, setCalls] = useState<CallView[]>([]);
  const onThisLead = phone.current?.leadId === leadId ? phone.current : null;
  const caps = phone.capabilities;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CallView[] }>(`/api/leads/${leadId}/calls`, {
      signal: controller.signal,
    }).then((result) => {
      if (result.ok) setCalls(result.data.items);
    });
    return () => controller.abort();
  }, [leadId, phone.version]);

  const browserProblem =
    phone.problem === "mic_denied" ||
    phone.problem === "no_mic" ||
    phone.problem === "failed" ||
    phone.problem === "connection_lost";
  const offerBrowser = Boolean(phone.available && caps?.browserCalling && !browserProblem);
  const offerPhone = Boolean(
    phone.available && caps?.clickToCall && (browserProblem || !caps.browserCalling),
  );

  return (
    <section aria-label="Calls" className={styles.panel}>
      <span className={styles.panelHead}>Calls</span>
      {phone.error ? <ErrorMessage error={phone.error} /> : null}
      {phone.problem ? (
        <div role="alert" className={styles.notice}>
          {PROBLEMS[phone.problem]}{" "}
          <button type="button" className={styles.button} onClick={phone.retryConnection}>
            Try again
          </button>
        </div>
      ) : null}
      {onThisLead && onThisLead.status !== "RINGING_AGENT" ? <CallCard call={onThisLead} /> : null}
      {!phone.current && offerBrowser ? (
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={() => phone.start(leadId, "BROWSER")}
        >
          Call
        </button>
      ) : null}
      {!phone.current && offerPhone ? (
        <button
          type="button"
          className={styles.button}
          onClick={() => phone.start(leadId, "PHONE")}
        >
          Call via my phone
        </button>
      ) : null}
      {phone.available && !caps?.browserCalling && !caps?.clickToCall && caps ? (
        <span className={styles.muted}>Calling isn&apos;t available right now.</span>
      ) : null}
      {calls.length === 0 ? <span className={styles.muted}>No calls yet.</span> : null}
      {calls
        .filter((call) => isEnded(call.status))
        .map((call) => (
          <div key={call.id} className={styles.call}>
            <span>
              <b>
                {call.direction === "INBOUND"
                  ? call.answeredAt
                    ? "Incoming call"
                    : "Missed call"
                  : "Outgoing call"}
              </b>
              {call.durationSeconds
                ? ` · ${call.durationSeconds} s`
                : ` · ${ENDED_LABELS[call.status]}`}
            </span>
            <span className={styles.muted}>
              {call.agent?.name ?? "Nobody"} ·{" "}
              {formatInstant(parseInstant(call.startedAt), "dateTime")}
            </span>
            {call.outcomeCode ? (
              <span>
                Outcome: {CALL_OUTCOMES[call.outcomeCode as CallOutcome]}
                {call.outcomeNotes ? ` — ${call.outcomeNotes}` : ""}
              </span>
            ) : phone.available ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => phone.logOutcomeFor(call)}
              >
                Log outcome
              </button>
            ) : null}
            <RecordingState call={call} />
          </div>
        ))}
    </section>
  );
}
