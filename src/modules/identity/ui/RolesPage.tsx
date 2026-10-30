"use client";

// Roles & Permissions (Decision 23), Super Admin only. Permission codes appear only here, as small
// secondary text (P2-ROLES-15). Saving names the version this edit started from, so two people
// cannot silently overwrite each other.
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Field, FormError, fieldMessage } from "./peopleShared";
import styles from "./people.module.css";

interface Role {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  locked: boolean;
  userCount: number;
  permissions: string[];
  defaultPermissions: string[] | null;
  version: string;
}
interface Permission {
  code: string;
  label: string;
  description: string;
  module: string;
}
interface RolesData {
  roles: Role[];
  permissions: Permission[];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

function NewRoleDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: Role[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const copyable = roles.filter((role) => !role.locked);
  const [name, setName] = useState("");
  const [copyFromCode, setCopyFromCode] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await apiRequest<Role>("/api/roles", {
      method: "POST",
      body: { name, copyFromCode: copyFromCode || null },
    });
    setBusy(false);
    if (result.ok) onCreated(result.data.id);
    else setError(result.error);
  }
  return (
    <Dialog title="New role" onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <FormError error={error} fields={["name", "copyFromCode"]} />
        <Field id="role-name" label="Role name" error={fieldMessage(error, "name")}>
          <input
            id="role-name"
            className={styles.control}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          id="role-copy"
          label="Start from"
          error={fieldMessage(error, "copyFromCode")}
          hint="You can change every permission next."
        >
          <select
            id="role-copy"
            className={styles.control}
            value={copyFromCode}
            onChange={(event) => setCopyFromCode(event.target.value)}
          >
            <option value="">No permissions</option>
            {copyable.map((role) => (
              <option key={role.code} value={role.code}>
                Copy of {role.name}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            Create role
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  role,
  onClose,
  onSaved,
}: {
  role: Role;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/roles/${role.id}`, {
      method: "PATCH",
      body: { name, version: role.version },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog title={`Rename ${role.name}`} onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <FormError error={error} fields={["name"]} />
        <Field id="rename-role" label="Role name" error={fieldMessage(error, "name")}>
          <input
            id="rename-role"
            className={styles.control}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const access = usePageAccess("roles:manage");
  const router = useRouter();
  const selectedId = useSearchParams().get("role");
  const [data, setData] = useState<RolesData | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  // An edit belongs to one version of one role; a different role or version starts fresh.
  const [edit, setEdit] = useState<{ key: string; codes: string[] } | null>(null);
  const [find, setFind] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"new" | "rename" | "reset" | "delete" | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<RolesData>("/api/roles");
    if (result.ok) setData(result.data);
    else setLoadError(result.error);
    return result;
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<RolesData>("/api/roles", { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setData(result.data);
      else setLoadError(result.error);
    });
    return () => controller.abort();
  }, [access]);

  const role = useMemo(
    () => data?.roles.find((item) => item.id === selectedId) ?? data?.roles[0] ?? null,
    [data, selectedId],
  );

  const editKey = role ? `${role.id}:${role.version}` : "";
  const draft = edit?.key === editKey ? edit.codes : (role?.permissions ?? []);
  const setDraft = (update: (current: string[]) => string[]) =>
    setEdit({ key: editKey, codes: update(draft) });

  const groups = useMemo(() => {
    const term = find.trim().toLowerCase();
    const map = new Map<string, Permission[]>();
    for (const permission of data?.permissions ?? []) {
      const text = `${permission.label} ${permission.description} ${permission.code}`.toLowerCase();
      if (term && !text.includes(term)) continue;
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission]);
    }
    return [...map.entries()];
  }, [data, find]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || loadError) {
    return (
      <main>
        <h1 className={styles.title}>Roles &amp; Permissions</h1>
        <ErrorMessage error={(access !== "allowed" ? access : loadError) as FriendlyError} />
      </main>
    );
  }
  if (!data || !role) return <main>Loading…</main>;

  const select = (id: string) => router.replace(`/roles?role=${id}`, { scroll: false });
  const dirty = !sameSet(draft, role.permissions);
  const labelOf = (code: string) =>
    data.permissions.find((permission) => permission.code === code)?.label ?? code;

  async function save() {
    if (!role) return;
    const result = await apiRequest(`/api/roles/${role.id}`, {
      method: "PATCH",
      body: { permissions: draft, version: role.version },
    });
    if (result.ok) {
      setNotice("Saved. This applies the next time these people load a page.");
      await load();
    } else {
      setError(result.error);
    }
  }

  async function reset() {
    if (!role) return;
    const result = await apiRequest(`/api/roles/${role.id}/reset`, {
      method: "POST",
      body: { version: role.version },
    });
    setDialog(null);
    if (result.ok) {
      setNotice(`${role.name} is back to its defaults.`);
      await load();
    } else setError(result.error);
  }

  async function remove() {
    if (!role) return;
    const result = await apiRequest(`/api/roles/${role.id}`, { method: "DELETE" });
    setDialog(null);
    if (result.ok) {
      setNotice(`${role.name} was deleted.`);
      router.replace("/roles", { scroll: false });
      await load();
    } else setError(result.error);
  }

  const resetChanges = role.defaultPermissions
    ? {
        on: role.defaultPermissions.filter((code) => !role.permissions.includes(code)),
        off: role.permissions.filter((code) => !role.defaultPermissions?.includes(code)),
      }
    : null;

  return (
    <main className={styles.split}>
      <section aria-label="Roles" className={styles.splitList}>
        <div className={styles.splitHead}>
          <h1>Roles</h1>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => setDialog("new")}
          >
            + New role
          </button>
        </div>
        {data.roles.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.listItem}
            aria-current={item.id === role.id}
            onClick={() => {
              setNotice("");
              setError(null);
              select(item.id);
            }}
          >
            <span className={styles.listItemText}>
              <span className={styles.listItemName}>{item.name}</span>
              <span className={styles.listItemNote}>
                {item.locked
                  ? "Full access · can't be edited"
                  : item.isSystem
                    ? "Built-in"
                    : "Custom"}
              </span>
            </span>
            <span className={styles.pill}>
              {item.userCount} {item.userCount === 1 ? "user" : "users"}
            </span>
          </button>
        ))}
      </section>

      <section aria-label={`${role.name} permissions`} className={styles.splitDetail}>
        <div className={styles.heading}>
          <div className={styles.detailTitle}>
            <h2>{role.name}</h2>
            <span className={styles.subtitle}>
              {role.locked ? "Built-in role" : role.isSystem ? "Built-in role" : "Custom role"} ·{" "}
              {role.userCount} {role.userCount === 1 ? "person" : "people"}
              {role.locked ? "" : ` · ${draft.length} of ${data.permissions.length} permissions on`}
            </span>
          </div>
          {!role.locked && !role.isSystem ? (
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
            </>
          ) : null}
          {!role.locked && role.isSystem ? (
            <button type="button" className={styles.button} onClick={() => setDialog("reset")}>
              Reset to defaults
            </button>
          ) : null}
          {!role.locked ? (
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={!dirty}
              onClick={save}
            >
              Save
            </button>
          ) : null}
        </div>

        {notice ? (
          <div role="status" className={styles.success}>
            {notice}
          </div>
        ) : null}
        <FormError error={error} />

        {role.locked ? (
          <div className={styles.notice}>
            This role always has every permission, so no one can lock themselves out. It can&apos;t
            be renamed, changed or deleted.
          </div>
        ) : (
          <>
            <input
              aria-label="Find a permission"
              placeholder="Find a permission"
              className={`${styles.control} ${styles.search}`}
              value={find}
              onChange={(event) => setFind(event.target.value)}
            />
            {groups.map(([module, permissions]) => (
              <section key={module} className={styles.group}>
                <div className={styles.groupHead}>
                  <h3>{module}</h3>
                  <span className={styles.subtitle}>
                    {permissions.filter((permission) => draft.includes(permission.code)).length} of{" "}
                    {permissions.length} on
                  </span>
                </div>
                {permissions.map((permission) => {
                  const on = draft.includes(permission.code);
                  return (
                    <div key={permission.code} className={styles.permission}>
                      <span className={styles.permissionText}>
                        <span className={styles.permissionLabel}>{permission.label}</span>
                        <span className={styles.permissionHelp}>{permission.description}</span>
                        <code className={styles.permissionCode}>{permission.code}</code>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={permission.label}
                        className={styles.switch}
                        onClick={() =>
                          setDraft((current) =>
                            on
                              ? current.filter((code) => code !== permission.code)
                              : [...current, permission.code],
                          )
                        }
                      >
                        <span />
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </section>

      {dialog === "new" ? (
        <NewRoleDialog
          roles={data.roles}
          onClose={() => setDialog(null)}
          onCreated={async (id) => {
            setDialog(null);
            await load();
            select(id);
          }}
        />
      ) : null}
      {dialog === "rename" ? (
        <RenameDialog
          role={role}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
          }}
        />
      ) : null}
      {dialog === "reset" && resetChanges ? (
        <Dialog title={`Reset ${role.name} to defaults?`} onClose={() => setDialog(null)}>
          {resetChanges.on.length + resetChanges.off.length === 0 ? (
            <p className={styles.dialogText}>This role already matches its defaults.</p>
          ) : (
            <>
              <p className={styles.dialogText}>These will go back to how they started:</p>
              <ul className={styles.dialogText}>
                {resetChanges.on.map((code) => (
                  <li key={code}>{labelOf(code)} → on</li>
                ))}
                {resetChanges.off.map((code) => (
                  <li key={code}>{labelOf(code)} → off</li>
                ))}
              </ul>
            </>
          )}
          <p className={styles.subtitle}>
            Affects {role.userCount} {role.userCount === 1 ? "person" : "people"} the next time they
            load a page.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className={`${styles.button} ${styles.primary}`} onClick={reset}>
              Reset
            </button>
          </div>
        </Dialog>
      ) : null}
      {dialog === "delete" ? (
        <Dialog title={`Delete ${role.name}?`} onClose={() => setDialog(null)}>
          <p className={styles.dialogText}>This can&apos;t be undone.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.dangerSolid}`}
              onClick={remove}
            >
              Delete role
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
