// The settings registry: every key, its default and what values it accepts. Values live in
// system_settings. A changed setting applies to new work only; work already running keeps the value
// it started with (Decision 57).
import { z } from "zod";

const minutes = (max: number) => z.number().int().min(1).max(max);

export const SETTINGS = {
  "sla.firstResponseMinutes": {
    label: "First reply target",
    help: "Minutes a new enquiry can wait for a first reply.",
    group: "Pipeline & SLA",
    defaultValue: 15,
    schema: minutes(1440),
  },
  "assignment.timeoutMinutes": {
    label: "Response timeout",
    help: "Minutes an agent has to respond before a lead moves on.",
    group: "Assignment",
    defaultValue: 30,
    schema: minutes(10080),
  },
  "assignment.defaultOpenLeadCap": {
    label: "Default open-lead cap",
    help: "How many open leads an agent can hold unless their own cap says otherwise.",
    group: "Assignment",
    defaultValue: 50,
    schema: z.number().int().min(1).max(10000),
  },
  "assignment.poolExpiryMinutes": {
    label: "Blast pool expiry",
    help: "Minutes a blast offer stays open before it expires.",
    group: "Assignment",
    defaultValue: 15,
    schema: minutes(1440),
  },
  "telephony.inboundFallback": {
    label: "If the owner misses a call",
    help: "Who rings next when a lead's owner doesn't answer.",
    group: "Calls & recordings",
    defaultValue: "available_agent",
    options: { available_agent: "Ring any available agent", manager: "Ring the manager" },
    schema: z.enum(["available_agent", "manager"]),
  },
  "recording.format": {
    label: "Recording format",
    help: "File format recordings are stored in.",
    group: "Calls & recordings",
    defaultValue: "mp3",
    options: { mp3: "MP3" },
    schema: z.enum(["mp3"]),
  },
  "recording.bitrateKbps": {
    label: "Recording quality (kbps)",
    help: "Lower takes less storage. 24 is clear for speech.",
    group: "Calls & recordings",
    defaultValue: 24,
    schema: z.number().int().min(8).max(320),
  },
  "retention.recordingDays": {
    label: "Keep recordings for (days)",
    help: "Older recordings are deleted for good.",
    group: "Data & retention",
    defaultValue: 180,
    schema: z.number().int().min(1).max(3650),
  },
  "retention.messageDays": {
    label: "Keep messages for (days)",
    help: "Older WhatsApp messages are deleted.",
    group: "Data & retention",
    defaultValue: 730,
    schema: z.number().int().min(1).max(3650),
  },
  "retention.webhookEventDays": {
    label: "Keep webhook logs for (days)",
    help: "Older technical logs are deleted.",
    group: "Data & retention",
    defaultValue: 30,
    schema: z.number().int().min(1).max(3650),
  },
  "realtime.pollFallbackSeconds": {
    label: "Refresh without live updates (seconds)",
    help: "How often screens refresh if the live connection can't be made.",
    group: "General",
    defaultValue: 15,
    schema: z.number().int().min(5).max(600),
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);
