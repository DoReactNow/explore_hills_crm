// Every kind of notification, and where it goes (Decision 63). In-app always applies. `list` is the
// page a grouped notification opens, since it no longer stands for one record.
export const NOTIFICATION_KINDS = {
  lead_assigned: {
    list: "/leads",
    email: true,
    push: true,
    label: "New lead",
    single: "A lead was assigned to you",
    grouped: "new leads were assigned to you",
  },
  lead_reassigned: {
    list: "/leads",
    email: true,
    push: true,
    label: "Lead moved",
    single: "A lead moved",
    grouped: "leads moved",
  },
  missed_call: {
    list: "/calls?filter=missed",
    email: true,
    push: true,
    label: "Missed call",
    single: "Missed call",
    grouped: "missed calls",
  },
  lead_escalated: {
    list: "/queue",
    email: true,
    push: true,
    label: "Needs a manager",
    single: "A lead needs a manager",
    grouped: "leads need a manager",
  },
  sla_missed: {
    list: "/leads",
    email: true,
    push: true,
    label: "First reply late",
    single: "First reply is late",
    grouped: "first replies are late",
  },
  sla_escalated: {
    list: "/leads",
    email: true,
    push: true,
    label: "First reply very late",
    single: "A first reply is very late",
    grouped: "first replies are very late",
  },
  blast_offer: {
    list: "/blast",
    email: false,
    push: true,
    label: "Blast offer",
    single: "A lead is up for grabs",
    grouped: "leads are up for grabs",
  },
  customer_message: {
    list: "/inbox",
    email: false,
    push: true,
    label: "New message",
    single: "New customer message",
    grouped: "new customer messages",
  },
  followups_due: {
    list: "/follow-ups",
    email: true,
    push: false,
    label: "Follow-ups due",
    single: "Follow-ups due",
    grouped: "follow-up reminders",
  },
  recording_failed: {
    list: "/calls",
    email: true,
    push: false,
    label: "Recording lost",
    single: "A recording couldn't be saved",
    grouped: "recordings couldn't be saved",
  },
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** Like events within this time join one notification, so a busy minute doesn't flood anyone. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
