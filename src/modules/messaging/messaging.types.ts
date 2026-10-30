// Types and constants of the messaging module that UI code may import (no Prisma here).

export const WHATSAPP_TEXT_LIMIT = 4096;
export const WINDOW_HOURS = 24;

export const TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
export const TEMPLATE_LANGUAGES = { en: "English", hi: "हिन्दी (Hindi)" } as const;

/** What a person sees for a failed message. Provider codes never reach the screen. */
export const FAILURE_MESSAGES: Record<string, string> = {
  window_closed:
    "The 24-hour reply window had closed before this could send. Send a template instead.",
  template_unavailable: "This template is no longer approved, so it wasn't sent.",
  opted_out: "This customer has opted out, so it wasn't sent.",
};
export const GENERIC_FAILURE = "This message couldn't be delivered. You can try again.";

export const failureMessage = (code: string | null) =>
  code === null ? GENERIC_FAILURE : (FAILURE_MESSAGES[code] ?? GENERIC_FAILURE);

/** Placeholders like {{1}}, in order of first appearance. */
export function templatePlaceholders(body: string): number[] {
  return [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))];
}

export function renderTemplate(body: string, variables: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index) => variables[Number(index) - 1] ?? whole);
}

/** Received and sent files. Anything else is refused and never stored. */
export const FILE_TYPES: Record<
  string,
  { extension: string; kind: "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO"; sendLimitMb: number }
> = {
  "image/jpeg": { extension: "jpg", kind: "IMAGE", sendLimitMb: 5 },
  "image/png": { extension: "png", kind: "IMAGE", sendLimitMb: 5 },
  "image/webp": { extension: "webp", kind: "IMAGE", sendLimitMb: 5 },
  "application/pdf": { extension: "pdf", kind: "DOCUMENT", sendLimitMb: 25 },
  "application/msword": { extension: "doc", kind: "DOCUMENT", sendLimitMb: 25 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: "docx",
    kind: "DOCUMENT",
    sendLimitMb: 25,
  },
  "application/vnd.ms-excel": { extension: "xls", kind: "DOCUMENT", sendLimitMb: 25 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extension: "xlsx",
    kind: "DOCUMENT",
    sendLimitMb: 25,
  },
  "audio/ogg": { extension: "ogg", kind: "AUDIO", sendLimitMb: 16 },
  "audio/mpeg": { extension: "mp3", kind: "AUDIO", sendLimitMb: 16 },
  "audio/aac": { extension: "aac", kind: "AUDIO", sendLimitMb: 16 },
  "audio/mp4": { extension: "m4a", kind: "AUDIO", sendLimitMb: 16 },
  "video/mp4": { extension: "mp4", kind: "VIDEO", sendLimitMb: 16 },
};
export const MAX_RECEIVED_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const OPT_OUT_WORDS = new Set(["stop", "unsubscribe", "बंद", "बंद करो", "रोको", "अनसब्सक्राइब"]);
const OPT_IN_WORDS = new Set(["start", "शुरू"]);

const asKeyword = (text: string | null) => (text ?? "").trim().toLowerCase();
export const isOptOut = (text: string | null) => OPT_OUT_WORDS.has(asKeyword(text));
export const isOptIn = (text: string | null) => OPT_IN_WORDS.has(asKeyword(text));
