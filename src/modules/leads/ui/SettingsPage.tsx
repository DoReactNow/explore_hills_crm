"use client";

// System settings and the pipeline stages, for those with settings:manage. Saving applies to new
// work only.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Field, FormError, StageChip, fieldMessage, type StageOption } from "./shared";
import styles from "./leads.module.css";

interface Setting {
  key: string;
  label: string;
  help: string;
  group: string;
  value: string | number;
  options: Record<string, string> | null;
}

function SettingField({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [value, setValue] = useState(String(setting.value));
  const [error, setError] = useState<FriendlyError | null>(null);
  const id = `setting-${setting.key}`;

  async function save(next: string) {
    const body = { key: setting.key, value: setting.options ? next : Number(next) };
    const result = await apiRequest("/api/settings", { method: "PATCH", body });
    if (result.ok) {
      setError(null);
      if (next !== String(setting.value)) onSaved();
    } else setError(result.error);
  }

  return (
    <Field id={id} label={setting.label} hint={setting.help} error={fieldMessage(error, "value")}>
      {setting.options ? (
        <select
          id={id}
          className={styles.control}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            void save(event.target.value);
          }}
        >
          {Object.entries(setting.options).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          inputMode="numeric"
          className={styles.control}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save(value)}
        />
      )}
    </Field>
  );
}

function StageNameDialog({
  stage,
  nextPosition,
  onClose,
  onSaved,
}: {
  stage: StageOption | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(stage?.name ?? "");
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = stage
      ? await apiRequest(`/api/settings/stages/${stage.id}`, { method: "PATCH", body: { name } })
      : await apiRequest("/api/settings/stages", {
          method: "POST",
          body: { name, position: nextPosition },
        });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog title={stage ? `Rename ${stage.name}` : "New stage"} onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <FormError error={error} fields={["name"]} />
        <Field id="stage-name" label="Stage name" error={fieldMessage(error, "name")}>
          <input
            id="stage-name"
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

export function SettingsPage() {
  const access = usePageAccess("settings:manage");
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<StageOption | "new" | null>(null);

  const loadStages = useCallback(async () => {
    const result = await apiRequest<StageOption[]>("/api/settings/stages");
    if (result.ok) setStages(result.data);
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    apiRequest<Setting[]>("/api/settings").then((result) => {
      if (result.ok) setSettings(result.data);
      else setError(result.error);
    });
    apiRequest<StageOption[]>("/api/settings/stages").then((result) => {
      if (result.ok) setStages(result.data);
    });
  }, [access]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || error) {
    return (
      <main>
        <h1 className={styles.title}>Settings</h1>
        <ErrorMessage error={(access !== "allowed" ? access : error) as FriendlyError} />
      </main>
    );
  }
  if (!settings) return <main aria-busy="true">Loading…</main>;

  const groups = [...new Set(settings.map((setting) => setting.group))];

  async function moveStage(stage: StageOption, offset: -1 | 1) {
    const other = stages[stages.indexOf(stage) + offset];
    if (!other) return;
    const results = await Promise.all([
      apiRequest(`/api/settings/stages/${stage.id}`, {
        method: "PATCH",
        body: { position: other.position },
      }),
      apiRequest(`/api/settings/stages/${other.id}`, {
        method: "PATCH",
        body: { position: stage.position },
      }),
    ]);
    const failed = results.find((result) => !result.ok);
    setActionError(failed && !failed.ok ? failed.error : null);
    await loadStages();
  }

  async function toggleStage(stage: StageOption) {
    const result = await apiRequest(`/api/settings/stages/${stage.id}`, {
      method: "PATCH",
      body: { isActive: !stage.isActive },
    });
    setActionError(result.ok ? null : result.error);
    await loadStages();
  }

  async function deleteStage(stage: StageOption) {
    const result = await apiRequest(`/api/settings/stages/${stage.id}`, { method: "DELETE" });
    setActionError(result.ok ? null : result.error);
    await loadStages();
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      {notice ? (
        <div role="status" className={styles.success}>
          {notice}
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.heading}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 16 }}>Pipeline stages</h2>
          <button type="button" className={styles.button} onClick={() => setEditing("new")}>
            + New stage
          </button>
        </div>
        <span className={styles.muted}>“Unassigned” is about ownership, not a stage.</span>
        <FormError error={actionError} />
        {stages.map((stage, index) => (
          <div key={stage.id} className={styles.stageRow}>
            <StageChip code={stage.code} name={stage.name} />
            {!stage.isActive ? <span className={styles.muted}>Switched off</span> : null}
            <span className="spacer" style={{ flex: 1 }} />
            <button
              type="button"
              className={styles.button}
              aria-label={`Move ${stage.name} up`}
              disabled={index === 0}
              onClick={() => moveStage(stage, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={`Move ${stage.name} down`}
              disabled={index === stages.length - 1}
              onClick={() => moveStage(stage, 1)}
            >
              ↓
            </button>
            <button type="button" className={styles.button} onClick={() => setEditing(stage)}>
              Rename
            </button>
            <button type="button" className={styles.button} onClick={() => toggleStage(stage)}>
              {stage.isActive ? "Switch off" : "Switch on"}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              onClick={() => deleteStage(stage)}
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      {groups.map((group) => (
        <section key={group} className={styles.card}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{group}</h2>
          <div className={styles.settingsGrid}>
            {settings
              .filter((setting) => setting.group === group)
              .map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  onSaved={() =>
                    setNotice(
                      "Saved. This applies to new work; work already running keeps its value.",
                    )
                  }
                />
              ))}
          </div>
        </section>
      ))}

      {editing ? (
        <StageNameDialog
          stage={editing === "new" ? null : editing}
          nextPosition={
            Math.max(...stages.filter((s) => s.kind === "OPEN").map((s) => s.position), 0) + 1
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadStages();
          }}
        />
      ) : null}
    </main>
  );
}
