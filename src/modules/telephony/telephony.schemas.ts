// What the telephony routes accept.
import { z } from "zod";
import { isBusinessDate } from "@/shared/time";
import { CALL_OUTCOMES, type CallOutcome } from "./telephony.types";

export const startCallSchema = z.object({
  clientRef: z.uuid(),
  channel: z.enum(["BROWSER", "PHONE"]).default("BROWSER"),
});
export type StartCallInput = z.infer<typeof startCallSchema>;

export const endCallSchema = z.object({ reason: z.enum(["cancelled", "failed", "hangup"]) });
export type EndCallInput = z.infer<typeof endCallSchema>;

export const outcomeSchema = z.object({
  outcome: z.enum(Object.keys(CALL_OUTCOMES) as [CallOutcome, ...CallOutcome[]], {
    error: "Please choose how the call went.",
  }),
  notes: z.string().trim().max(2000).optional(),
  followUpDate: z.string().refine(isBusinessDate, "Please enter a date.").optional(),
  followUpTitle: z.string().trim().max(200).optional(),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

export const listCallsSchema = z.object({
  filter: z.enum(["all", "missed"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
});
export type ListCallsInput = z.infer<typeof listCallsSchema>;

export const endpointSchema = z.object({
  login: z.string().min(1).max(200),
  secret: z.string().min(1).max(500).optional(),
});
export type EndpointInput = z.infer<typeof endpointSchema>;

export const fakeControlSchema = z.object({
  callRef: z.string().max(100).optional(),
  callId: z.string().max(100).optional(),
  status: z.string().max(40).optional(),
  duration: z.number().int().min(0).optional(),
  recording: z.string().max(100).optional(),
  inboundFrom: z.string().max(40).optional(),
});
export type FakeControlInput = z.infer<typeof fakeControlSchema>;
