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
  "sla.holidays": {
    label: "Holidays",
    help: "Dates with commas between, as YYYY-MM-DD. SLA clocks and reminders stop on these days. Empty means none.",
    group: "Pipeline & SLA",
    defaultValue: "",
    schema: z
      .string()
      .trim()
      .regex(
        /^(\d{4}-\d{2}-\d{2}(,\s*\d{4}-\d{2}-\d{2})*)?$/,
        "Please use dates like 2026-12-25, with commas between.",
      ),
  },
  "sla.reminderTime": {
    label: "Daily follow-up reminder (IST)",
    help: "24-hour time, such as 09:30. Sent once on each working day.",
    group: "Pipeline & SLA",
    defaultValue: "09:30",
    schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please use a time like 09:30."),
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
    defaultValue: 12,
    schema: z.number().int().min(1).max(10000),
  },
  "assignment.maxTimeouts": {
    label: "Timeouts before a manager steps in",
    help: "After this many missed responses in a row, a lead is flagged for a manager.",
    group: "Assignment",
    defaultValue: 2,
    schema: z.number().int().min(1).max(20),
  },
  "assignment.poolExpiryMinutes": {
    label: "Blast pool expiry",
    help: "Minutes a blast offer stays open before it expires.",
    group: "Assignment",
    defaultValue: 5,
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
  "telephony.workingDays": {
    label: "Working days",
    help: "Numbers with commas between: 0 is Sunday and 6 is Saturday.",
    group: "Calls & recordings",
    defaultValue: "1,2,3,4,5,6",
    schema: z.string().regex(/^[0-6](,[0-6])*$/, "Please use numbers 0 to 6 with commas between."),
  },
  "telephony.workingFrom": {
    label: "Working hours start (IST)",
    help: "24-hour time, such as 10:00.",
    group: "Calls & recordings",
    defaultValue: "10:00",
    schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please use a time like 10:00."),
  },
  "telephony.workingTo": {
    label: "Working hours end (IST)",
    help: "24-hour time, such as 19:00.",
    group: "Calls & recordings",
    defaultValue: "19:00",
    schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please use a time like 19:00."),
  },
  "telephony.outOfHoursMessage": {
    label: "Out-of-hours message",
    help: "What a caller hears outside working hours. {company} becomes your company's name.",
    group: "Calls & recordings",
    defaultValue:
      "Thank you for calling {company}. We're closed right now. Please leave a message after the tone, and we'll get back to you during working hours.",
    schema: z.string().trim().min(1).max(500),
  },
  "telephony.outOfHoursMessageHindi": {
    label: "Out-of-hours message (Hindi)",
    help: "The same message in Hindi.",
    group: "Calls & recordings",
    defaultValue:
      "{company} को कॉल करने के लिए धन्यवाद। अभी हमारा कार्यालय बंद है। कृपया बीप के बाद अपना संदेश छोड़ें। हम कार्य समय में आपसे संपर्क करेंगे।",
    schema: z.string().trim().min(1).max(500),
  },
  "telephony.recordingNotice": {
    label: "Recording announcement",
    help: "What a caller hears before a recorded call.",
    group: "Calls & recordings",
    defaultValue: "This call may be recorded for quality and training purposes.",
    schema: z.string().trim().min(1).max(300),
  },
  "telephony.recordingNoticeHindi": {
    label: "Recording announcement (Hindi)",
    help: "The same announcement in Hindi.",
    group: "Calls & recordings",
    defaultValue: "गुणवत्ता और प्रशिक्षण के लिए यह कॉल रिकॉर्ड की जा सकती है।",
    schema: z.string().trim().min(1).max(300),
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
    defaultValue: 90,
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
