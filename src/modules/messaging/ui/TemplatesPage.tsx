"use client";

// WhatsApp templates. Only approved ones can be sent after the 24-hour reply window closes.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { TEMPLATE_CATEGORIES, TEMPLATE_LANGUAGES } from "../messaging.types";
import styles from "./messaging.module.css";

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  rejectedReason: string | null;
}

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const languageLabel = (code: string) =>
  (TEMPLATE_LANGUAGES as Record<string, string>)[code] ?? code;
const badge = (status: string) =>
  `${styles.badge} ${(styles as Record<string, string>)[`badge${status}`] ?? ""}`;

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: template?.name ?? "",
    language: template?.language ?? "en",
    category: template?.category ?? "UTILITY",
    body: template?.body ?? "",
  });
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const message = (field: string) =>
    error?.fieldErrors?.find((item) => item.field === field)?.message;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = template
      ? await apiRequest(`/api/templates/${template.id}`, {
          method: "PATCH",
          body: { body: form.body, category: form.category },
        })
      : await apiRequest("/api/templates", { method: "POST", body: form });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(result.error);
  }

  return (
    <Dialog title={template ? `Edit ${template.name}` : "New template"} onClose={onClose}>
      <form onSubmit={submit} className={styles.page} noValidate>
        {error && !error.fieldErrors?.length ? <ErrorMessage error={error} /> : null}
        {!template ? (
          <>
            <div className={styles.field}>
              <label htmlFor="tpl-name">Name</label>
              <input
                id="tpl-name"
                className={styles.control}
                value={form.name}
                onChange={set("name")}
              />
              {message("name") ? (
                <span className={styles.fieldError}>{message("name")}</span>
              ) : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="tpl-language">Language</label>
              <select
                id="tpl-language"
                className={styles.control}
                value={form.language}
                onChange={set("language")}
              >
                {Object.entries(TEMPLATE_LANGUAGES).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="tpl-category">Category</label>
          <select
            id="tpl-category"
            className={styles.control}
            value={form.category}
            onChange={set("category")}
          >
            {TEMPLATE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {titleCase(category)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="tpl-body">Message</label>
          <textarea
            id="tpl-body"
            className={styles.textarea}
            rows={4}
            value={form.body}
            onChange={set("body")}
          />
          {message("body") ? (
            <span className={styles.fieldError}>{message("body")}</span>
          ) : (
            <span className={styles.fieldHint}>
              Use {"{{1}}"}, {"{{2}}"} for details we fill in, like name and destination.
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            Submit for approval
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TemplatesPage() {
  const access = usePageAccess("messaging:manage-templates");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<Template[]>("/api/templates");
    if (result.ok) setTemplates(result.data);
    else setError(result.error);
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    apiRequest<Template[]>("/api/templates").then((result) => {
      if (result.ok) setTemplates(result.data);
      else setError(result.error);
    });
  }, [access]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || error) {
    return (
      <main>
        <h1 className={styles.title}>WhatsApp templates</h1>
        <ErrorMessage error={(access !== "allowed" ? access : error) as FriendlyError} />
      </main>
    );
  }

  async function remove(template: Template) {
    const result = await apiRequest(`/api/templates/${template.id}`, { method: "DELETE" });
    if (result.ok) await load();
    else setError(result.error);
  }

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div className={styles.headingText}>
          <h1 className={styles.title}>WhatsApp templates</h1>
          <span className={styles.muted}>
            Approved templates can be sent after the 24-hour reply window closes.
          </span>
        </div>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={() => setEditing("new")}
        >
          + New template
        </button>
      </div>
      {!templates ? <p aria-busy="true">Loading…</p> : null}
      {templates?.length === 0 ? <p className={styles.muted}>No templates yet.</p> : null}
      {templates && templates.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Language</th>
                <th>Status</th>
                <th>Message</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.name}</td>
                  <td>{titleCase(template.category)}</td>
                  <td>{languageLabel(template.language)}</td>
                  <td>
                    <span className={badge(template.status)}>{titleCase(template.status)}</span>
                  </td>
                  <td>
                    {template.body}
                    {template.rejectedReason ? (
                      <div className={styles.fieldError}>
                        Why it was rejected: {template.rejectedReason}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => setEditing(template)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.danger}`}
                        onClick={() => remove(template)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </main>
  );
}
