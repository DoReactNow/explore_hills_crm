// What the privacy routes accept.
import { z } from "zod";

export const searchSchema = z.object({
  search: z.string().trim().min(3, "Please type at least 3 characters.").max(100),
});
export type SearchInput = z.infer<typeof searchSchema>;

export const CONSENT_SOURCES = ["phone_call", "email", "in_person", "written_form"] as const;

export const consentSchema = z.object({
  purpose: z.enum(["WHATSAPP", "CALL_RECORDING"]),
  status: z.enum(["GRANTED", "WITHDRAWN"]),
  source: z.enum(CONSENT_SOURCES),
});
export type ConsentInput = z.infer<typeof consentSchema>;

export const holdSchema = z.object({
  on: z.boolean(),
  // A choice, not free text: the reason stays in the audit trail for good.
  reason: z.enum(["legal_claim", "open_complaint", "regulator_request"]).optional(),
});
export type HoldInput = z.infer<typeof holdSchema>;

export const eraseSchema = z.object({
  confirmPhone: z.string().trim().min(1, "Please type the customer's number."),
});
export type EraseInput = z.infer<typeof eraseSchema>;
