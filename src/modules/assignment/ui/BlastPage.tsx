"use client";

// The blast pool: leads an agent is being offered. The first to accept gets the lead. Cards keep
// their place, and one someone else took stays for a moment so it doesn't vanish under the cursor.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { parseInstant, systemClock } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "./assignment.module.css";

const NOTICES = ["assignment.poolChanged"];
const POLL_MS = 15_000;
const GONE_MS = 6_000;
const URGENT_SECONDS = 60;

interface Offer {
  id: string;
  expiresAt: string;
  createdAt: string;
  leadId: string;
  customer: string | null;
  source: string;
  destination: string | null;
  travellerCount: number | null;
  travelStartDate: string | null;
  budgetAmount: string | null;
  message: string | null;
}
interface Pool {
  room: number;
  block: string | null;
  items: Offer[];
}

const SOURCES: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  MANUAL: "Manual",
  WEBSITE: "Website",
  AD: "Ad",
  IMPORT: "Import",
};
const rupees = (amount: string) => `₹${new Intl.NumberFormat("en-IN").format(Number(amount))}`;
const secondsLeft = (at: string) =>
  Math.max(0, Math.floor((parseInstant(at).getTime() - systemClock.now().getTime()) / 1000));
const clockLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;

export function BlastPage() {
  const access = usePageAccess("leads:claim");
  const router = useRouter();
  const [pool, setPool] = useState<Pool | null>(null);
  const [cards, setCards] = useState<Offer[]>([]);
  const [gone, setGone] = useState<Record<string, string>>({});
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [, setTick] = useState(0);
  const cardsRef = useRef<Offer[]>([]);

  const dropLater = useCallback((id: string) => {
    setTimeout(() => {
      cardsRef.current = cardsRef.current.filter((card) => card.id !== id);
      setCards(cardsRef.current);
      setGone((now) => {
        const rest = { ...now };
        delete rest[id];
        return rest;
      });
    }, GONE_MS);
  }, []);

  const refresh = useCallback(async () => {
    const next = await apiRequest<Pool>("/api/assignment/pool");
    if (!next.ok) {
      setError(next.error);
      return;
    }
    setPool(next.data);
    const live = new Set(next.data.items.map((item) => item.id));
    const known = new Set(cardsRef.current.map((card) => card.id));
    // New leads slide in at the end, so cards never move under the cursor.
    cardsRef.current = [
      ...cardsRef.current,
      ...next.data.items.filter((item) => !known.has(item.id)),
    ];
    setCards(cardsRef.current);
    for (const card of cardsRef.current) {
      if (!live.has(card.id)) {
        setGone((now) => {
          if (now[card.id]) return now;
          dropLater(card.id);
          return {
            ...now,
            [card.id]: secondsLeft(card.expiresAt) === 0 ? "This offer has ended" : "Already taken",
          };
        });
      }
    }
  }, [dropLater]);

  useLiveEvents({ types: NOTICES, onEvent: refresh, onResync: refresh });

  useEffect(() => {
    if (access !== "allowed") return;
    const first = setTimeout(refresh, 0);
    const poll = setInterval(refresh, POLL_MS);
    const second = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(second);
    };
  }, [access, refresh]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <h1 className={styles.headline}>Blast pool</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  async function accept(offer: Offer) {
    setError(null);
    const result = await apiRequest<{ leadId: string }>(`/api/assignment/pool/${offer.id}/claim`, {
      method: "POST",
    });
    if (result.ok) {
      setMine(offer.id);
      router.push(`/leads/${result.data.leadId}`);
      return;
    }
    setError(result.error);
    refresh();
  }

  const open = cards.filter((card) => !gone[card.id]).length;

  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.headline}>
          {open} {open === 1 ? "lead" : "leads"} up for <span className={styles.accent}>grabs</span>
        </h1>
        <span className={styles.muted}>
          First to accept gets the lead · you have room for {pool?.room ?? 0} more
        </span>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      {pool && cards.length === 0 ? (
        <p className={styles.muted}>
          Nothing to accept right now. New offers appear here on their own.
        </p>
      ) : null}
      <div className={styles.grid}>
        {cards.map((offer) => {
          const left = secondsLeft(offer.expiresAt);
          const total = Math.max(
            1,
            (parseInstant(offer.expiresAt).getTime() - parseInstant(offer.createdAt).getTime()) /
              1000,
          );
          const status = mine === offer.id ? "It's yours · opening lead…" : gone[offer.id];
          const urgent = left <= URGENT_SECONDS;
          return (
            <article key={offer.id} className={`${styles.offer} ${status ? styles.offerGone : ""}`}>
              <div className={styles.cardRow}>
                <span className={styles.chip}>{offer.destination ?? "No destination"}</span>
                <span className={styles.muted}>{SOURCES[offer.source] ?? offer.source}</span>
                {!status ? (
                  <span className={`${styles.right} ${urgent ? styles.late : ""}`}>
                    {clockLabel(left)}
                  </span>
                ) : null}
              </div>
              {!status ? (
                <div className={styles.track}>
                  <div
                    className={`${styles.fill} ${urgent ? styles.fillLate : ""}`}
                    style={{ width: `${Math.min(100, (left / total) * 100)}%` }}
                  />
                </div>
              ) : null}
              <span className={styles.offerName}>{offer.customer ?? "Unnamed customer"}</span>
              {offer.message ? <span>“{offer.message}”</span> : null}
              <span className={styles.muted}>
                {[
                  offer.travellerCount ? `${offer.travellerCount} people` : null,
                  offer.travelStartDate,
                  offer.budgetAmount ? rupees(offer.budgetAmount) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {status ? (
                <div role="status" className={styles.status}>
                  {status}
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={left === 0 || pool?.room === 0}
                  onClick={() => accept(offer)}
                >
                  Accept lead
                </button>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
