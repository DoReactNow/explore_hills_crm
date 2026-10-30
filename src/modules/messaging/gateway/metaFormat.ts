// Reads Meta's webhook format, which resellers mostly mirror. A piece it can't read is left out and
// the rest still counts, so one odd item never loses the others (P4-WEBHOOK-05, -06).
import { instantFromEpochMs, toIsoInstant } from "@/shared/time";
import type { GatewayEvent, InboundMessageEvent, InboundType } from "./types";

type Json = Record<string, unknown>;

const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function instant(seconds: unknown): string | null {
  const parsed = Number(seconds);
  return Number.isFinite(parsed) && parsed > 0
    ? toIsoInstant(instantFromEpochMs(parsed * 1000))
    : null;
}

const MEDIA_TYPES: Record<string, InboundType> = {
  image: "IMAGE",
  sticker: "IMAGE",
  document: "DOCUMENT",
  audio: "AUDIO",
  voice: "AUDIO",
  video: "VIDEO",
};

function describeContent(
  message: Json,
): Pick<InboundMessageEvent, "type" | "body" | "mediaId" | "mimeType" | "filename"> {
  const none = { mediaId: null, mimeType: null, filename: null };
  const kind = str(message.type) ?? "unknown";
  if (kind === "text") return { ...none, type: "TEXT", body: str(obj(message.text).body) ?? "" };
  if (MEDIA_TYPES[kind]) {
    const media = obj(message[kind]);
    return {
      type: MEDIA_TYPES[kind],
      body: str(media.caption),
      mediaId: str(media.id),
      mimeType: str(media.mime_type),
      filename: str(media.filename),
    };
  }
  if (kind === "location") {
    const place = obj(message.location);
    const label = str(place.name) ?? `${String(place.latitude)}, ${String(place.longitude)}`;
    return { ...none, type: "INTERACTIVE", body: `Shared a location: ${label}` };
  }
  if (kind === "contacts") {
    const name = str(obj(obj(arr(message.contacts)[0]).name).formatted_name);
    return { ...none, type: "INTERACTIVE", body: `Shared a contact${name ? `: ${name}` : ""}` };
  }
  if (kind === "reaction") {
    return {
      ...none,
      type: "INTERACTIVE",
      body: `Reacted ${str(obj(message.reaction).emoji) ?? ""}`.trim(),
    };
  }
  if (kind === "button")
    return { ...none, type: "INTERACTIVE", body: str(obj(message.button).text) };
  if (kind === "interactive") {
    const reply = obj(obj(message.interactive).button_reply);
    const list = obj(obj(message.interactive).list_reply);
    return { ...none, type: "INTERACTIVE", body: str(reply.title) ?? str(list.title) };
  }
  return { ...none, type: "UNSUPPORTED", body: null };
}

function parseValue(value: Json): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  const phoneNumberId = str(obj(value.metadata).phone_number_id) ?? "";
  const businessNumber = str(obj(value.metadata).display_phone_number)?.replace(/\D/g, "");
  const names = new Map(
    arr(value.contacts).map((item) => [str(obj(item).wa_id), str(obj(obj(item).profile).name)]),
  );

  for (const item of arr(value.messages)) {
    const message = obj(item);
    const waMessageId = str(message.id);
    const from = str(message.from);
    const occurredAt = instant(message.timestamp);
    if (!waMessageId || !from || !occurredAt) continue;
    events.push({
      kind: "message",
      key: `message:${waMessageId}`,
      waMessageId,
      phoneNumberId,
      from,
      profileName: names.get(from) ?? null,
      replyToWaId: str(obj(message.context).id),
      occurredAt,
      ignorable: from === businessNumber || Boolean(str(message.group_id)),
      ...describeContent(message),
    });
  }

  for (const item of arr(value.statuses)) {
    const status = obj(item);
    const waMessageId = str(status.id);
    const raw = str(status.status)?.toUpperCase();
    const occurredAt = instant(status.timestamp);
    if (!waMessageId || !occurredAt) continue;
    if (raw !== "SENT" && raw !== "DELIVERED" && raw !== "READ" && raw !== "FAILED") continue;
    const code = obj(arr(status.errors)[0]).code;
    events.push({
      kind: "status",
      key: `status:${waMessageId}:${raw}`,
      waMessageId,
      status: raw,
      occurredAt,
      errorCode: code === undefined ? null : String(code),
    });
  }

  const name = str(value.message_template_name);
  const language = str(value.message_template_language);
  const event = str(value.event);
  if (name && language && event) {
    events.push({
      kind: "template",
      key: `template:${name}:${language}:${event}:${String(value.message_template_id ?? "")}`,
      name,
      language,
      status: event.toUpperCase(),
      reason: str(value.reason),
    });
  }
  return events;
}

export function parseMetaWebhook(body: unknown): GatewayEvent[] {
  return arr(obj(body).entry).flatMap((entry) =>
    arr(obj(entry).changes).flatMap((change) => {
      try {
        return parseValue(obj(obj(change).value));
      } catch {
        return [];
      }
    }),
  );
}
