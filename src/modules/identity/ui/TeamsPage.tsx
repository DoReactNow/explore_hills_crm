"use client";

// Teams: list and detail. A Manager sees the teams in their branch, read-only; anyone with
// teams:manage can change them. The selected team is in the URL, so Back returns to it.
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Avatar, Field, FormError, StatusBadge, fieldMessage, whenLabel } from "./peopleShared";
import styles from "./people.module.css";

interface Team {
  id: string;
  name: string;
  manager: { id: string; name: string } | null;
  members: Array<{
    user: { id: string; name: string; email: string; status: string; lastLoginAt: string | null };
  }>;
}
interface Person {
  id: string;
  name: string;
}

type DialogState = "new" | "rename" | "manager" | "add" | "delete" | null;

function SingleFieldDialog({
  title,
  label,
  initial,
  submitLabel,
  field,
  onClose,
  send,
}: {
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  field: string;
  onClose: () => void;
  send: (value: string) => Promise<FriendlyError | null>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const failure = await send(value);
    setBusy(false);
    if (failure) setError(failure);
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <FormError error={error} fields={[field]} />
        <Field id="team-field" label={label} error={fieldMessage(error, field)}>
          <input
            id="team-field"
            className={styles.control}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PersonPickerDialog({
  title,
  people,
  initial,
  allowNone,
  submitLabel,
  field,
  onClose,
  send,
}: {
  title: string;
  people: Person[];
  initial: string;
  allowNone: boolean;
  submitLabel: string;
  field: string;
  onClose: () => void;
  send: (value: string) => Promise<FriendlyError | null>;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const failure = await send(value);
    setBusy(false);
    if (failure) setError(failure);
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <FormError error={error} fields={[field]} />
        <Field id="team-person" label="Person" error={fieldMessage(error, field)}>
          <select
            id="team-person"
            className={styles.control}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {allowNone ? <option value="">No manager</option> : <option value="">Choose…</option>}
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TeamsPage() {
  const access = usePageAccess("teams:view");
  const { can } = usePrincipal();
  const manage = can("teams:manage");
  const router = useRouter();
  const selectedId = useSearchParams().get("team");
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<Team[]>("/api/teams");
    if (result.ok) setTeams(result.data);
    else setLoadError(result.error);
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    apiRequest<Team[]>("/api/teams").then((result) => {
      if (result.ok) setTeams(result.data);
      else setLoadError(result.error);
    });
    if (manage && can("users:view")) {
      void apiRequest<{ items: Person[] }>("/api/users?status=ACTIVE&pageSize=200").then(
        (result) => {
          if (result.ok) setPeople(result.data.items);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, manage]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || loadError) {
    return (
      <main>
        <h1 className={styles.title}>Teams</h1>
        <ErrorMessage error={(access !== "allowed" ? access : loadError) as FriendlyError} />
      </main>
    );
  }
  if (!teams) return <main>Loading…</main>;

  const selected = teams.find((team) => team.id === selectedId) ?? teams[0] ?? null;
  const select = (id: string) => router.replace(`/teams?team=${id}`, { scroll: false });

  async function act(path: string, method: string, body?: unknown): Promise<FriendlyError | null> {
    const result = await apiRequest<Team>(path, { method, body });
    if (!result.ok) return result.error;
    setDialog(null);
    setActionError(null);
    await load();
    return null;
  }

  return (
    <main className={styles.split}>
      <section aria-label="Teams" className={styles.splitList}>
        <div className={styles.splitHead}>
          <h1>Teams</h1>
          {manage ? (
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => setDialog("new")}
            >
              + New team
            </button>
          ) : null}
        </div>
        {teams.length === 0 ? <p>No teams yet.</p> : null}
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className={styles.listItem}
            aria-current={team.id === selected?.id}
            onClick={() => select(team.id)}
          >
            <span className={styles.listItemText}>
              <span className={styles.listItemName}>{team.name}</span>
              <span className={styles.listItemNote}>Manager: {team.manager?.name ?? "None"}</span>
              <span className={styles.listItemNote}>
                {team.members.length} {team.members.length === 1 ? "member" : "members"}
              </span>
            </span>
          </button>
        ))}
      </section>

      {selected ? (
        <section aria-label={selected.name} className={styles.splitDetail}>
          <div className={styles.heading}>
            <div className={styles.detailTitle}>
              <h2>{selected.name}</h2>
              <span className={styles.subtitle}>{selected.members.length} members</span>
            </div>
            {manage ? (
              <>
                <button type="button" className={styles.button} onClick={() => setDialog("rename")}>
                  Rename
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.danger}`}
                  onClick={() => setDialog("delete")}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  onClick={() => setDialog("add")}
                >
                  + Add members
                </button>
              </>
            ) : null}
          </div>
          <FormError error={actionError} />
          <div className={styles.managerBox}>
            {selected.manager ? <Avatar name={selected.manager.name} /> : null}
            <div className={styles.detailTitle}>
              <span className={styles.subtitle}>Manager</span>
              <strong>{selected.manager?.name ?? "No manager"}</strong>
            </div>
            {manage ? (
              <button type="button" className={styles.button} onClick={() => setDialog("manager")}>
                Change manager
              </button>
            ) : null}
          </div>
          {selected.members.length === 0 ? (
            <p>No members yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    {manage ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {selected.members.map(({ user }) => (
                    <tr key={user.id}>
                      <td>
                        <span className={styles.rowLink}>
                          <Avatar name={user.name} />
                          <span className={styles.personText}>
                            <span className={styles.personName}>{user.name}</span>
                            <span className={styles.personMail}>{user.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={user.status} />
                      </td>
                      <td>{whenLabel(user.lastLoginAt)}</td>
                      {manage ? (
                        <td>
                          <button
                            type="button"
                            className={styles.button}
                            aria-label={`Remove ${user.name} from team`}
                            onClick={async () => {
                              const failure = await act(
                                `/api/teams/${selected.id}/members/${user.id}`,
                                "DELETE",
                              );
                              if (failure) setActionError(failure);
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {dialog === "new" ? (
        <SingleFieldDialog
          title="New team"
          label="Team name"
          initial=""
          submitLabel="Create team"
          field="name"
          onClose={() => setDialog(null)}
          send={(name) => act("/api/teams", "POST", { name })}
        />
      ) : null}
      {dialog === "rename" && selected ? (
        <SingleFieldDialog
          title={`Rename ${selected.name}`}
          label="Team name"
          initial={selected.name}
          submitLabel="Save"
          field="name"
          onClose={() => setDialog(null)}
          send={(name) => act(`/api/teams/${selected.id}`, "PATCH", { name })}
        />
      ) : null}
      {dialog === "manager" && selected ? (
        <PersonPickerDialog
          title={`Manager of ${selected.name}`}
          people={people}
          initial={selected.manager?.id ?? ""}
          allowNone
          submitLabel="Save"
          field="managerUserId"
          onClose={() => setDialog(null)}
          send={(id) => act(`/api/teams/${selected.id}`, "PATCH", { managerUserId: id || null })}
        />
      ) : null}
      {dialog === "add" && selected ? (
        <PersonPickerDialog
          title={`Add a member to ${selected.name}`}
          people={people.filter(
            (person) => !selected.members.some(({ user }) => user.id === person.id),
          )}
          initial=""
          allowNone={false}
          submitLabel="Add"
          field="userId"
          onClose={() => setDialog(null)}
          send={(userId) => act(`/api/teams/${selected.id}/members`, "POST", { userId })}
        />
      ) : null}
      {dialog === "delete" && selected ? (
        <Dialog title={`Delete ${selected.name}?`} onClose={() => setDialog(null)}>
          <p className={styles.dialogText}>This can&apos;t be undone.</p>
          <FormError error={actionError} />
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.dangerSolid}`}
              onClick={async () => {
                const failure = await act(`/api/teams/${selected.id}`, "DELETE");
                if (failure) setActionError(failure);
              }}
            >
              Delete team
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
