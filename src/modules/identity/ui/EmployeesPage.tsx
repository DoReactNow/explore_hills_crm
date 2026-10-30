"use client";

// The Admin's employee page (Decision 48). Filters, sort and page live in the URL, so Back returns
// to the same view. The server filters and sorts, so every column is correct across pages.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import {
  Avatar,
  Field,
  FormError,
  STATUS_LABELS,
  StatusBadge,
  fieldMessage,
  whenLabel,
  type PersonRow,
} from "./peopleShared";
import styles from "./people.module.css";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

const COLUMNS = [
  { sort: "name", label: "Name" },
  { sort: "role", label: "Role" },
  { sort: "team", label: "Team" },
  { sort: "manager", label: "Manager" },
  { sort: "status", label: "Status" },
  { sort: "lastLoginAt", label: "Last sign-in" },
] as const;

interface ListResult {
  items: PersonRow[];
  total: number;
  statusCounts: Record<string, number>;
}
interface Option {
  code: string;
  name: string;
}
interface TeamOption {
  id: string;
  name: string;
}

function AddEmployeeDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: Option[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    roleCode: roles[0]?.code ?? "",
  });
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await apiRequest<{ id: string }>("/api/users", { method: "POST", body: form });
    setBusy(false);
    if (result.ok) onCreated(result.data.id);
    else setError(result.error);
  }

  return (
    <Dialog title="Add employee" onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        <FormError error={error} fields={["name", "email", "password", "roleCode"]} />
        <Field id="new-name" label="Full name" error={fieldMessage(error, "name")}>
          <input
            id="new-name"
            className={styles.control}
            value={form.name}
            onChange={set("name")}
          />
        </Field>
        <Field id="new-email" label="Work email" error={fieldMessage(error, "email")}>
          <input
            id="new-email"
            type="email"
            autoComplete="off"
            className={styles.control}
            value={form.email}
            onChange={set("email")}
          />
        </Field>
        <Field
          id="new-password"
          label="Default password"
          error={fieldMessage(error, "password")}
          hint="At least 12 characters. Share it with them yourself; it can't be shown again."
        >
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className={styles.control}
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <Field id="new-role" label="Role" error={fieldMessage(error, "roleCode")}>
          <select
            id="new-role"
            className={styles.control}
            value={form.roleCode}
            onChange={set("roleCode")}
          >
            {roles.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            Add employee
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function EmployeesPage() {
  const access = usePageAccess("users:edit");
  const { can } = usePrincipal();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const search = params.get("search") ?? "";
  const roleCode = params.get("role") ?? "";
  const teamId = params.get("team") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "name";
  const direction = params.get("direction") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [searchText, setSearchText] = useState(search);
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [roles, setRoles] = useState<Option[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [adding, setAdding] = useState(false);

  const update = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(query);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const text = next.toString();
      router.replace(text ? `/employees?${text}` : "/employees", { scroll: false });
    },
    [query, router],
  );

  useEffect(() => {
    if (searchText === search) return;
    const timer = setTimeout(() => update({ search: searchText, page: "" }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search, update]);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    const request = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      direction,
    });
    if (search) request.set("search", search);
    if (roleCode) request.set("roleCode", roleCode);
    if (teamId) request.set("teamId", teamId);
    if (status) request.set("status", status);
    apiRequest<ListResult>(`/api/users?${request}`, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      if (next.ok) {
        setResult(next.data);
        setError(null);
      } else setError(next.error);
    });
    return () => controller.abort();
  }, [access, page, sort, direction, search, roleCode, teamId, status]);

  useEffect(() => {
    if (access !== "allowed") return;
    void apiRequest<Option[]>("/api/roles/options").then((next) => {
      if (next.ok) setRoles(next.data);
    });
    if (can("teams:view")) {
      void apiRequest<TeamOption[]>("/api/teams").then((next) => {
        if (next.ok) setTeams(next.data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main>
        <h1 className={styles.title}>Employees</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  const active = result?.statusCounts.ACTIVE ?? 0;
  const inactive = result?.statusCounts.DEACTIVATED ?? 0;
  const lastPage = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>
          Employees{" "}
          {result ? (
            <span className={styles.titleNote}>
              · {active} active, {inactive} inactive
            </span>
          ) : null}
        </h1>
        <input
          aria-label="Search name, email or phone"
          placeholder="Search name, email or phone"
          className={`${styles.control} ${styles.search}`}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        {can("users:create") ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => setAdding(true)}
          >
            + Add employee
          </button>
        ) : null}
      </div>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          Role
          <select
            className={styles.control}
            value={roleCode}
            onChange={(event) => update({ role: event.target.value, page: "" })}
          >
            <option value="">Any</option>
            {roles.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          Team
          <select
            className={styles.control}
            value={teamId}
            onChange={(event) => update({ team: event.target.value, page: "" })}
          >
            <option value="">Any</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          Status
          <select
            className={styles.control}
            value={status}
            onChange={(event) => update({ status: event.target.value, page: "" })}
          >
            <option value="">Any</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <ErrorMessage error={error} /> : null}
      {!result && !error ? <p>Loading…</p> : null}
      {result?.items.length === 0 ? <p>No employees match these filters.</p> : null}
      {result && result.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const current = sort === column.sort;
                  return (
                    <th
                      key={column.sort}
                      aria-sort={
                        current ? (direction === "asc" ? "ascending" : "descending") : "none"
                      }
                    >
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() =>
                          update({
                            sort: column.sort,
                            direction: current && direction === "asc" ? "desc" : "",
                            page: "",
                          })
                        }
                      >
                        {column.label} {current ? (direction === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.items.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link className={styles.rowLink} href={`/employees/${person.id}`}>
                      <Avatar name={person.name} />
                      <span className={styles.personText}>
                        <span className={styles.personName}>{person.name}</span>
                        <span className={styles.personMail}>{person.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td>{person.role.name}</td>
                  <td>{person.teamMemberships.map(({ team }) => team.name).join(", ") || "—"}</td>
                  <td>{person.manager?.name ?? "—"}</td>
                  <td>
                    <StatusBadge status={person.status} />
                  </td>
                  <td>{whenLabel(person.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {lastPage > 1 ? (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.button}
            disabled={page <= 1}
            onClick={() => update({ page: page > 2 ? String(page - 1) : "" })}
          >
            Previous
          </button>
          <span>
            Page {page} of {lastPage}
          </span>
          <button
            type="button"
            className={styles.button}
            disabled={page >= lastPage}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>
      ) : null}

      {adding ? (
        <AddEmployeeDialog
          roles={roles}
          onClose={() => setAdding(false)}
          onCreated={(id) => router.push(`/employees/${id}`)}
        />
      ) : null}
    </main>
  );
}
