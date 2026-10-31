// Values the telephony screens and the server share (no Prisma here).
export const CALL_STATUSES = [
  "INITIATED",
  "RINGING_AGENT",
  "RINGING_CUSTOMER",
  "ANSWERED",
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "CANCELLED",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const ENDED_STATUSES: readonly CallStatus[] = [
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "FAILED",
  "CANCELLED",
];
export const isEnded = (status: CallStatus) => ENDED_STATUSES.includes(status);

export const CALL_OUTCOMES = {
  INTERESTED: "Interested",
  CALL_BACK: "Call back later",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  WRONG_NUMBER: "Wrong number",
  BOOKED: "Booked",
  NOT_INTERESTED: "Not interested",
} as const;
export type CallOutcome = keyof typeof CALL_OUTCOMES;

export interface Capabilities {
  browserCalling: boolean;
  clickToCall: boolean;
  inboundRouting: boolean;
  recording: boolean;
  dualChannelRecording: boolean;
  liveStatusEvents: boolean;
}
