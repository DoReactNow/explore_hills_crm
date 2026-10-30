"use client";

// One employee: view and edit their details, role, teams and manager, set a new password, deactivate
// or reactivate. A Super Admin's record is read-only for an Admin; the server refuses it anyway.
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import {
  Avatar,
  Field,
  FormError,
  StatusBadge,
  fieldMessage,
  whenLabel,
  type PersonRow,
} from "./peopleShared";
import styles from "./people.module.css";

interface FormState {
  name: string;
  email: string;
  phoneE164: string;
  roleCode: string;
  managerId: string;
  teamIds: string[];
}

const toForm = (person: PersonRow): FormState => ({
  name: person.name,
  email: person.email,
  phoneE164: person.phoneE164 ?? "",
  roleCode: person.role.code,
  managerId: person.manager?.id ?? "",
  teamIds: person.teamMemberships.map(({ team }) => team.id),
});

function SetPasswordDialog({
  person,
  onClose,
  onSaved,
}: {
  person: PersonRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await apiRequest(`/api/users/${person.id}/password`, {
      method: "POST",
      body: { password },
    });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(result.error);
  }

  return (
    <Dialog title={`Set a new password for ${person.name}`} onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <p className={styles.dialogText}>Share it with them in person or by phone.</p>
        <FormError error={error} fields={["password"]} />
        <Field
          id="set-password"
          label="New password"
          error={fieldMessage(error, "password")}
          hint="At least 12 characters, with three of lowercase, uppercase, digits and symbols."
        >
          <input
            id="set-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            className={styles.control}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button type="button" className={styles.button} onClick={() => setShow((value) => !value)}>
          {show ? "Hide password" : "Show password"}
        </button>
        <div role="alert" className={styles.warning}>
          This person will be signed out of all devices. You won&apos;t be able to see this password
          again after saving.
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            Save password
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDeactivate({
  person,
  onClose,
  onDone,
}: {
  person: PersonRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLeads, setOpenLeads] = useState<number | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [choice, setChoice] = useState<"queue" | "agent" | "keep">("queue");
  const [toUserId, setToUserId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<{ openLeads: number }>(`/api/assignment/agents/${person.id}/open-leads`, {
      signal,
    }).then((result) => {
      if (result.ok) setOpenLeads(result.data.openLeads);
    });
    apiRequest<{ items: Array<{ id: string; name: string }> }>("/api/assignment/agents", {
      signal,
    }).then((result) => {
      if (result.ok) setAgents(result.data.items.filter((agent) => agent.id !== person.id));
    });
    return () => controller.abort();
  }, [person.id]);

  async function confirm() {
    setBusy(true);
    const result = await apiRequest(`/api/users/${person.id}/deactivate`, {
      method: "POST",
      body: choice === "agent" ? { openLeads: choice, toUserId } : { openLeads: choice },
    });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog title={`Deactivate ${person.name}?`} onClose={onClose}>
      <p className={styles.dialogText}>
        They&apos;ll be signed out and won&apos;t be able to sign in. You can reactivate them later.
      </p>
      {openLeads ? (
        <fieldset className={styles.dialogText}>
          <legend>
            <b>
              They have {openLeads} open {openLeads === 1 ? "lead" : "leads"}.
            </b>{" "}
            What should happen to {openLeads === 1 ? "it" : "them"}?
          </legend>
          <p>
            <label>
              <input
                type="radio"
                name="open-leads"
                checked={choice === "queue"}
                onChange={() => setChoice("queue")}
              />{" "}
              Move to the manager queue
            </label>
          </p>
          <p>
            <label>
              <input
                type="radio"
                name="open-leads"
                checked={choice === "agent"}
                onChange={() => setChoice("agent")}
              />{" "}
              Give them all to one agent
            </label>
          </p>
          {choice === "agent" ? (
            <p>
              <label>
                Agent{" "}
                <select value={toUserId} onChange={(event) => setToUserId(event.target.value)}>
                  <option value="">Choose…</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            </p>
          ) : null}
          <p>
            <label>
              <input
                type="radio"
                name="open-leads"
                checked={choice === "keep"}
                onChange={() => setChoice("keep")}
              />{" "}
              Leave them with this person
            </label>
          </p>
        </fieldset>
      ) : null}
      <FormError error={error} />
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.dangerSolid}`}
          disabled={busy || (choice === "agent" && !toUserId)}
          onClick={confirm}
        >
          Deactivate
        </button>
      </div>
    </Dialog>
  );
}

export function EmployeeDetailPage({ id }: { id: string }) {
  const access = usePageAccess("users:edit");
  const { can } = usePrincipal();
  const [person, setPerson] = useState<PersonRow | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saveError, setSaveError] = useState<FriendlyError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [roles, setRoles] = useState<Array<{ code: string; name: string }>>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [managers, setManagers] = useState<Array<{ id: string; name: string }>>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"password" | "deactivate" | null>(null);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    const signal = controller.signal;
    apiRequest<PersonRow>(`/api/users/${id}`, { signal }).then((result) => {
      if (signal.aborted) return;
      if (result.ok) {
        setPerson(result.data);
        setForm(toForm(result.data));
      } else setLoadError(result.error);
    });
    void apiRequest<{ id: string }>("/api/auth/me", { signal }).then((result) => {
      if (result.ok) setMyId(result.data.id);
    });
    void apiRequest<Array<{ code: string; name: string }>>("/api/roles/options", { signal }).then(
      (result) => {
        if (result.ok) setRoles(result.data);
      },
    );
    void apiRequest<{ items: Array<{ id: string; name: string }> }>(
      "/api/users?status=ACTIVE&pageSize=200",
      { signal },
    ).then((result) => {
      if (result.ok) setManagers(result.data.items);
    });
    if (can("teams:view")) {
      void apiRequest<Array<{ id: string; name: string }>>("/api/teams", { signal }).then(
        (result) => {
          if (result.ok) setTeams(result.data);
        },
      );
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, id]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main>
        <h1 className={styles.title}>Employee</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }
  if (loadError) {
    return (
      <main>
        <h1 className={styles.title}>Employee</h1>
        <ErrorMessage error={loadError} />
      </main>
    );
  }
  if (!person || !form) return <main>Loading…</main>;

  const self = myId === person.id;
  const set =
    (key: "name" | "email" | "phoneE164" | "roleCode" | "managerId") =>
    (event: { target: { value: string } }) =>
      setForm((current) => (current ? { ...current, [key]: event.target.value } : current));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setSaved("");
    const result = await apiRequest<PersonRow>(`/api/users/${id}`, {
      method: "PATCH",
      body: {
        name: form.name,
        email: form.email,
        phoneE164: form.phoneE164 || null,
        roleCode: form.roleCode,
        managerId: form.managerId || null,
        ...(can("teams:view") ? { teamIds: form.teamIds } : {}),
      },
    });
    setSaving(false);
    if (result.ok) {
      setSaveError(null);
      setSaved("Changes saved.");
      const fresh = await apiRequest<PersonRow>(`/api/users/${id}`);
      if (fresh.ok) {
        setPerson(fresh.data);
        setForm(toForm(fresh.data));
      }
    } else setSaveError(result.error);
  }

  async function reload(message: string) {
    setDialog(null);
    setSaved(message);
    const fresh = await apiRequest<PersonRow>(`/api/users/${id}`);
    if (fresh.ok) setPerson(fresh.data);
  }

  async function reactivate() {
    const result = await apiRequest(`/api/users/${id}/reactivate`, { method: "POST" });
    if (result.ok) await reload(`${person?.name} can sign in again.`);
    else setSaveError(result.error);
  }

  const header = (
    <div className={styles.detailHead}>
      <Avatar name={person.name} large />
      <div className={styles.detailName}>
        <div className={styles.nameLine}>
          <h1>{person.name}</h1>
          <StatusBadge status={person.status} />
        </div>
        <span className={styles.subtitle}>
          {person.role.name}
          {person.teamMemberships.length > 0
            ? ` · ${person.teamMemberships.map(({ team }) => team.name).join(", ")}`
            : ""}{" "}
          · last signed in: {whenLabel(person.lastLoginAt)}
        </span>
      </div>
      {person.canManage && !self && person.status !== "DEACTIVATED" ? (
        <>
          <button type="button" className={styles.button} onClick={() => setDialog("password")}>
            Set password
          </button>
          {can("users:deactivate") ? (
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              onClick={() => setDialog("deactivate")}
            >
              Deactivate
            </button>
          ) : null}
        </>
      ) : null}
      {person.canManage && person.status === "DEACTIVATED" && can("users:deactivate") ? (
        <button type="button" className={styles.button} onClick={reactivate}>
          Reactivate
        </button>
      ) : null}
    </div>
  );

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
      <Link href="/employees">Employees</Link> / <span>{person.name}</span>
    </nav>
  );

  if (!person.canManage) {
    return (
      <main className={styles.page}>
        {breadcrumb}
        {header}
        <div className={styles.notice}>Only another Super Admin can change this account.</div>
        <section className={styles.card}>
          <h2>Details</h2>
          <p className={styles.dialogText}>Email: {person.email}</p>
          <p className={styles.dialogText}>Mobile: {person.phoneE164 ?? "—"}</p>
          <p className={styles.dialogText}>
            Team: {person.teamMemberships.map(({ team }) => team.name).join(", ") || "—"}
          </p>
        </section>
      </main>
    );
  }

  const canEdit = can("users:edit");

  return (
    <main className={styles.page}>
      {breadcrumb}
      {header}
      {saved ? (
        <div role="status" className={styles.success}>
          {saved}
        </div>
      ) : null}
      <form onSubmit={save} className={styles.card} noValidate>
        <FormError
          error={saveError}
          fields={["name", "email", "phoneE164", "roleCode", "managerId", "teamIds"]}
        />
        <h2>Details</h2>
        <div className={styles.formGrid}>
          <Field id="e-name" label="Full name" error={fieldMessage(saveError, "name")}>
            <input
              id="e-name"
              className={styles.control}
              value={form.name}
              onChange={set("name")}
            />
          </Field>
          <Field
            id="e-email"
            label="Work email"
            error={fieldMessage(saveError, "email")}
            hint="Used to sign in"
          >
            <input
              id="e-email"
              type="email"
              className={styles.control}
              value={form.email}
              onChange={set("email")}
            />
          </Field>
          <Field
            id="e-phone"
            label="Mobile"
            error={fieldMessage(saveError, "phoneE164")}
            hint="With country code, like +91…"
          >
            <input
              id="e-phone"
              type="tel"
              className={styles.control}
              value={form.phoneE164}
              onChange={set("phoneE164")}
            />
          </Field>
        </div>
        <h2>Role and team</h2>
        <div className={styles.formGrid}>
          <Field
            id="e-role"
            label="Role"
            error={fieldMessage(saveError, "roleCode")}
            hint={self ? "You can't change your own role." : undefined}
          >
            <select
              id="e-role"
              className={styles.control}
              value={form.roleCode}
              disabled={self}
              onChange={set("roleCode")}
            >
              {roles.some((role) => role.code === form.roleCode) ? null : (
                <option value={form.roleCode}>{person.role.name}</option>
              )}
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="e-manager" label="Manager" error={fieldMessage(saveError, "managerId")}>
            <select
              id="e-manager"
              className={styles.control}
              value={form.managerId}
              onChange={set("managerId")}
            >
              <option value="">No manager</option>
              {person.manager && !managers.some((m) => m.id === person.manager?.id) ? (
                <option value={person.manager.id}>{person.manager.name}</option>
              ) : null}
              {managers
                .filter((manager) => manager.id !== person.id)
                .map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name}
                  </option>
                ))}
            </select>
          </Field>
          {can("teams:view") ? (
            <fieldset className={styles.field} style={{ border: "none", padding: 0, margin: 0 }}>
              <legend>Teams</legend>
              <div className={styles.checkList}>
                {teams.length === 0 ? (
                  <span className={styles.fieldHint}>No teams yet.</span>
                ) : null}
                {teams.map((team) => (
                  <label key={team.id} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={form.teamIds.includes(team.id)}
                      onChange={(event) =>
                        setForm((current) =>
                          current
                            ? {
                                ...current,
                                teamIds: event.target.checked
                                  ? [...current.teamIds, team.id]
                                  : current.teamIds.filter((teamId) => teamId !== team.id),
                              }
                            : current,
                        )
                      }
                    />
                    {team.name}
                  </label>
                ))}
              </div>
              {fieldMessage(saveError, "teamIds") ? (
                <span className={styles.fieldError}>{fieldMessage(saveError, "teamIds")}</span>
              ) : null}
            </fieldset>
          ) : null}
        </div>
        {canEdit ? (
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setForm(toForm(person))}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.button} ${styles.primary}`}
              disabled={saving}
            >
              Save changes
            </button>
          </div>
        ) : null}
      </form>

      {dialog === "password" ? (
        <SetPasswordDialog
          person={person}
          onClose={() => setDialog(null)}
          onSaved={() => reload(`Password saved. ${person.name} has been signed out everywhere.`)}
        />
      ) : null}
      {dialog === "deactivate" ? (
        <ConfirmDeactivate
          person={person}
          onClose={() => setDialog(null)}
          onDone={() => reload(`${person.name} has been deactivated.`)}
        />
      ) : null}
    </main>
  );
}
