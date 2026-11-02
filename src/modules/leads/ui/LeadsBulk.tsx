"use client";

// Acting on several leads at once from the list (Leads-Desktop design): reassign, change stage, set a
// follow-up. Each lead goes through the same API as on its own page, so every check still applies, and
// the person is told plainly how many changed and how many could not.
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { todayBusinessDate, systemClock } from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { Field, FormError, type StageOption } from "./shared";
import styles from "./leads.module.css";

export type BulkAction = "reassign" | "stage" | "followUp";

interface Outcome {
  done: number;
  failed: number;
  firstError: FriendlyError | null;
}

type Attempt = { ok: true } | { ok: false; error: FriendlyError };

async function eachLead(
  ids: readonly string[],
  run: (id: string) => Promise<Attempt>,
): Promise<Outcome> {
  let done = 0;
  let firstError: FriendlyError | null = null;
  for (const id of ids) {
    const result = await run(id);
    if (result.ok) done += 1;
    else firstError ??= result.error;
  }
  return { done, failed: ids.length - done, firstError };
}

const leadsWord = (n: number) => (n === 1 ? "1 lead" : `${n} leads`);

export function outcomeMessage(
  action: BulkAction,
  outcome: Pick<Outcome, "done" | "failed">,
  label: string,
): string {
  const verb =
    action === "reassign"
      ? `reassigned to ${label}`
      : action === "stage"
        ? `moved to ${label}`
        : "given a follow-up";
  const done = `${leadsWord(outcome.done)} ${verb}.`;
  return outcome.failed > 0
    ? `${done} ${leadsWord(outcome.failed)} couldn’t be changed, maybe because they moved on or you can’t edit them.`
    : done;
}

export function BulkDialog({
  action,
  leadIds,
  stages,
  onClose,
  onDone,
}: {
  action: BulkAction;
  leadIds: readonly string[];
  stages: readonly StageOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [agents, setAgents] = useState<
    Array<{ id: string; name: string; openLeads: number; cap: number }>
  >([]);
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayBusinessDate(systemClock));
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (action !== "reassign") return;
    const controller = new AbortController();
    apiRequest<{ items: typeof agents }>("/api/assignment/agents", {
      signal: controller.signal,
    }).then((result) => {
      if (result.ok) setAgents(result.data.items);
      else if (!controller.signal.aborted) setError(result.error);
    });
    return () => controller.abort();
  }, [action]);

  // Lost asks for a reason per lead, so it stays on each lead's own page.
  const movable = stages.filter((stage) => stage.isActive && stage.kind !== "LOST");
  const count = leadsWord(leadIds.length);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    let outcome: Outcome;
    let label = "";
    if (action === "reassign") {
      label = agents.find((agent) => agent.id === toUserId)?.name ?? "the new owner";
      outcome = await eachLead(leadIds, (id) =>
        apiRequest(`/api/leads/${id}/reassign`, { method: "POST", body: { toUserId, reason } }),
      );
    } else if (action === "stage") {
      label = movable.find((stage) => stage.code === stageCode)?.name ?? "the new stage";
      outcome = await eachLead(leadIds, (id) =>
        apiRequest(`/api/leads/${id}/stage`, { method: "POST", body: { stageCode } }),
      );
    } else {
      outcome = await eachLead(leadIds, (id) =>
        apiRequest(`/api/leads/${id}/tasks`, { method: "POST", body: { title, dueDate } }),
      );
    }
    setBusy(false);
    if (outcome.done === 0) {
      setError(outcome.firstError);
      return;
    }
    onDone(outcomeMessage(action, outcome, label));
  }

  const heading =
    action === "reassign"
      ? `Reassign ${count}`
      : action === "stage"
        ? `Change the stage of ${count}`
        : `Set a follow-up on ${count}`;
  const ready =
    action === "reassign"
      ? Boolean(toUserId && reason.trim())
      : action === "stage"
        ? Boolean(stageCode)
        : Boolean(title.trim() && dueDate);

  return (
    <Dialog title={heading} onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <FormError error={error} />
        {action === "reassign" ? (
          <>
            <p className={styles.dialogText}>
              Their open follow-ups and chats move to the new owner, and customers see no change.
            </p>
            <Field id="bulk-to" label="New owner">
              <select
                id="bulk-to"
                className={styles.control}
                value={toUserId}
                onChange={(event) => setToUserId(event.target.value)}
              >
                <option value="">Choose…</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.openLeads} of {agent.cap} open
                  </option>
                ))}
              </select>
            </Field>
            <Field id="bulk-reason" label="Reason">
              <input
                id="bulk-reason"
                className={styles.control}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        {action === "stage" ? (
          <Field
            id="bulk-stage"
            label="New stage"
            hint="To mark leads as Lost, open each one so you can give the reason."
          >
            <select
              id="bulk-stage"
              className={styles.control}
              value={stageCode}
              onChange={(event) => setStageCode(event.target.value)}
            >
              <option value="">Choose…</option>
              {movable.map((stage) => (
                <option key={stage.code} value={stage.code}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {action === "followUp" ? (
          <>
            <Field id="bulk-task" label="What needs doing">
              <input
                id="bulk-task"
                className={styles.control}
                maxLength={300}
                value={title}
                placeholder="Call back about dates"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field id="bulk-due" label="Due">
              <input
                id="bulk-due"
                type="date"
                className={styles.control}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={!ready || busy}
          >
            {busy ? "Saving…" : "Apply"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
