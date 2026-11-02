// Round initials badge (owner's design). The tint comes from the name, so a person keeps one colour
// everywhere; it is decoration, and the name always shows beside it.
import styles from "./Avatar.module.css";

const TONES = ["blue", "amber", "green", "violet", "rose", "slate"] as const;

function firstLetter(word: string): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const [first] = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word);
    return first?.segment ?? "";
  }
  return Array.from(word)[0] ?? "";
}

/** "RM" for Riya Mehta; one letter with its vowel sign for a Devanagari name ("सु"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (!/^[A-Za-z]/.test(words[0])) return firstLetter(words[0]);
  return words
    .slice(0, 2)
    .map((word) => firstLetter(word).toUpperCase())
    .join("");
}

function toneOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function Avatar({
  name,
  size = 36,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${styles[toneOf(name)]} ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** "+91 90000 00001" for an Indian mobile; anything else as stored. */
export function formatPhone(e164: string): string {
  if (e164.startsWith("erased-") || e164 === "hidden") return "Number erased";
  const india = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return india ? `+91 ${india[1]} ${india[2]}` : e164;
}
