"use client";

// Global search, ⌘K from anywhere (Shell-Overlays design). It asks the same list APIs the Leads and
// Employees pages use, so it finds only what the person may already see.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { Icon } from "@/shared/ui/Icon";
import { OPEN_SEARCH_EVENT } from "@/shared/ui/shellEvents";
import { phoneLabel, StageChip, type LeadRow } from "./shared";
import styles from "./search.module.css";

interface Person {
  id: string;
  name: string;
  email: string;
  phoneE164: string | null;
  role: { name: string };
  teamMemberships: { team: { name: string } }[];
}

interface Result {
  key: string;
  href: string;
}

const DEBOUNCE_MS = 200;
const VIEW_LEADS = ["leads:view-own", "leads:view-team", "leads:view-all"] as const;

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

/** Wraps the first match of the query in <mark>, so people see why a row came up. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (!needle) return <>{text}</>;
  const plain = text.toLowerCase();
  let at = plain.indexOf(query.trim().toLowerCase());
  let length = query.trim().length;
  if (at === -1) {
    // phone numbers are shown with spaces; match ignoring them
    const map: number[] = [];
    let squashed = "";
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== " ") {
        map.push(i);
        squashed += plain[i];
      }
    }
    const found = squashed.indexOf(needle);
    if (found === -1) return <>{text}</>;
    at = map[found];
    length = map[found + needle.length - 1] - at + 1;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.mark}>{text.slice(at, at + length)}</mark>
      {text.slice(at + length)}
    </>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const { can } = usePrincipal();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const seesLeads = VIEW_LEADS.some(can);
  const seesPeople = can("users:view");
  const scope = can("leads:view-all")
    ? "Searching all leads"
    : can("leads:view-team")
      ? "Searching your team’s leads"
      : "Searching your leads only";

  useEffect(() => {
    const show = () => {
      opener.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const q = encodeURIComponent(term);
      const [leadResult, peopleResult] = await Promise.all([
        seesLeads
          ? apiRequest<{ items: LeadRow[] }>(`/api/leads?search=${q}&pageSize=6`, {
              signal: controller.signal,
            })
          : null,
        seesPeople
          ? apiRequest<{ items: Person[] }>(`/api/users?search=${q}&pageSize=3`, {
              signal: controller.signal,
            })
          : null,
      ]);
      if (controller.signal.aborted) return;
      setLeads(leadResult?.ok ? leadResult.data.items : []);
      setPeople(peopleResult?.ok ? peopleResult.data.items : []);
      setSearched(term);
      setActive(0);
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open, seesLeads, seesPeople]);

  function close() {
    setOpen(false);
    setQuery("");
    setLeads([]);
    setPeople([]);
    setSearched("");
    opener.current?.focus?.();
  }

  if (!open) return null;

  const term = query.trim();
  const showing = term.length >= 2 && searched === term;
  const results: Result[] = [
    ...leads.map((lead) => ({ key: `lead-${lead.id}`, href: `/leads/${lead.id}` })),
    ...people.map((person) => ({ key: `person-${person.id}`, href: `/employees/${person.id}` })),
  ];

  function go(index: number) {
    const target = results[index];
    if (!target) return;
    close();
    router.push(target.href);
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((at) => Math.min(at + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((at) => Math.max(at - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            go(active);
          }
        }}
      >
        <div className={styles.inputRow}>
          <Icon name="search" size={20} />
          <label htmlFor="global-search" className={styles.hidden}>
            Search leads and people
          </label>
          <input
            id="global-search"
            ref={input}
            className={styles.input}
            value={query}
            placeholder="Name, phone number or destination"
            autoComplete="off"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={results[active] ? `gs-${results[active].key}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Results"
          className={styles.results}
        >
          {term.length < 2 ? (
            <p className={styles.hint}>Type at least two letters or digits.</p>
          ) : null}
          {showing && results.length === 0 ? (
            <div className={styles.none}>
              <span className={styles.noneTitle}>Nothing for “{term}”</span>
              <span className={styles.hint}>
                Try a name, a phone number or a destination. Searching works across Hindi and
                English names.
              </span>
            </div>
          ) : null}
          {showing && leads.length > 0 ? (
            <span className={styles.group}>Leads · {leads.length}</span>
          ) : null}
          {showing
            ? leads.map((lead, index) => {
                const name = lead.contact.name ?? phoneLabel(lead.contact.phoneE164);
                return (
                  <button
                    key={lead.id}
                    id={`gs-lead-${lead.id}`}
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    className={styles.row}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(index)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {initialsOf(name)}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>
                        <Highlight text={name} query={term} />
                      </span>
                      <span className={styles.rowMeta}>
                        <Highlight text={phoneLabel(lead.contact.phoneE164)} query={term} />
                        {lead.destination ? (
                          <>
                            {" · "}
                            <Highlight text={lead.destination} query={term} />
                          </>
                        ) : null}
                        {" · "}
                        {lead.owner?.name ?? "Unassigned"}
                      </span>
                    </span>
                    <StageChip code={lead.stage.code} name={lead.stage.name} />
                  </button>
                );
              })
            : null}
          {showing && people.length > 0 ? (
            <span className={styles.group}>Employees · {people.length}</span>
          ) : null}
          {showing
            ? people.map((person, offset) => {
                const index = leads.length + offset;
                const team = person.teamMemberships[0]?.team.name;
                return (
                  <button
                    key={person.id}
                    id={`gs-person-${person.id}`}
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    className={styles.row}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(index)}
                  >
                    <span className={`${styles.avatar} ${styles.avatarPerson}`} aria-hidden="true">
                      {initialsOf(person.name)}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>
                        <Highlight text={person.name} query={term} />
                      </span>
                      <span className={styles.rowMeta}>
                        {[person.role.name, team].filter(Boolean).join(" · ")}
                        {" · "}
                        {person.phoneE164 ? (
                          <Highlight text={phoneLabel(person.phoneE164)} query={term} />
                        ) : (
                          <Highlight text={person.email} query={term} />
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            : null}
        </div>
        <div className={styles.footer}>
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span className={styles.scope}>{scope}</span>
        </div>
      </div>
    </div>
  );
}
