// Request shapes of the leads API, with friendly messages. Unknown fields are stripped, so an
// ordinary edit can never reach the owner, stage or closed time.
import { z } from "zod";
import { isBusinessDate } from "@/shared/time";
import { normalisePhone } from "./leads.phone";
import { FOLLOW_UP_BUCKETS, LEAD_SORTS, MANUAL_SOURCES } from "./leads.types";

const MAX_BUDGET = 1_000_000_000;
const MAX_TRAVELLERS = 500;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || null)
    .nullish();

const businessDate = (message: string) => z.string().refine(isBusinessDate, { message }).nullish();

const budget = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount in rupees, with at most two decimals.")
  .refine((value) => Number(value) <= MAX_BUDGET, "That budget looks too high. Please check it.")
  .nullish();

const travellers = z
  .number({ error: "Enter how many people are travelling." })
  .int("Enter a whole number of people.")
  .min(1, "At least 1 person is travelling.")
  .max(MAX_TRAVELLERS, "That's more travellers than we can take on one lead.")
  .nullish();

/** Only these are kept; anything else is dropped (Decision 57). */
const customFields = z
  .object({
    stay: z.string().trim().max(200, "That's too long.").optional(),
    language: z.string().trim().max(100, "That's too long.").optional(),
  })
  .optional();

const tripFields = {
  destination: optionalText(120, "That destination is too long."),
  travelStartDate: businessDate("Please choose a valid start date."),
  travelEndDate: businessDate("Please choose a valid end date."),
  travellerCount: travellers,
  budgetAmount: budget,
  customFields,
};

const datesInOrder = (value: { travelStartDate?: string | null; travelEndDate?: string | null }) =>
  !value.travelStartDate || !value.travelEndDate || value.travelEndDate >= value.travelStartDate;
const datesMessage = {
  message: "The trip can't end before it starts.",
  path: ["travelEndDate"],
};

export const createLeadSchema = z
  .object({
    customerName: z
      .string({ error: "Add the customer's name. A first name is enough." })
      .trim()
      .min(1, "Add the customer's name. A first name is enough.")
      .max(200, "That name is too long."),
    phone: z.string({ error: "Please enter a phone number." }).transform((value, context) => {
      const phone = normalisePhone(value);
      if (!phone) {
        context.addIssue({
          code: "custom",
          message: "That number doesn't look right. Please check the digits.",
        });
        return z.NEVER;
      }
      return phone;
    }),
    source: z.enum(MANUAL_SOURCES, { error: "Please choose a source." }).default("MANUAL"),
    ownerUserId: z.string().trim().min(1).nullish(),
    note: optionalText(5000, "That note is too long."),
    ...tripFields,
  })
  .refine(datesInOrder, datesMessage);
export type CreateLeadInput = z.output<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    customerName: z
      .string()
      .trim()
      .min(1, "Add the customer's name. A first name is enough.")
      .max(200, "That name is too long.")
      .optional(),
    version: z.iso.datetime({ error: "Please refresh and try again." }),
    ...tripFields,
  })
  .refine(datesInOrder, datesMessage);
export type UpdateLeadInput = z.output<typeof updateLeadSchema>;

export const moveStageSchema = z.object({
  stageCode: z.string({ error: "Please choose a stage." }).trim().min(1, "Please choose a stage."),
  lostReason: optionalText(500, "That reason is too long."),
});
export type MoveStageInput = z.output<typeof moveStageSchema>;

export const addNoteSchema = z.object({
  body: z
    .string({ error: "Write something first." })
    .trim()
    .min(1, "Write something first.")
    .max(5000, "That note is too long."),
});
export type AddNoteInput = z.output<typeof addNoteSchema>;

export const addTaskSchema = z.object({
  title: z
    .string({ error: "Say what needs doing." })
    .trim()
    .min(1, "Say what needs doing.")
    .max(300, "That's too long."),
  dueDate: z
    .string({ error: "Please choose a date." })
    .refine(isBusinessDate, { message: "Please choose a valid date." }),
  assigneeUserId: z.string().trim().min(1).nullish(),
});
export type AddTaskInput = z.output<typeof addTaskSchema>;

export const setTaskSchema = z.object({ completed: z.boolean() });
export type SetTaskInput = z.output<typeof setTaskSchema>;

export const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(200).optional(),
  stage: z.string().trim().max(64).optional(),
  owner: z.string().trim().max(64).optional(),
  source: z.string().trim().max(32).optional(),
  destination: z.string().trim().max(120).optional(),
  travelFrom: z.string().refine(isBusinessDate).optional(),
  travelTo: z.string().refine(isBusinessDate).optional(),
  sort: z.enum(LEAD_SORTS).default("lastActivityAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ListLeadsInput = z.output<typeof listLeadsSchema>;

export const listFollowUpsSchema = z.object({
  bucket: z.enum(FOLLOW_UP_BUCKETS).default("open"),
});
export type ListFollowUpsInput = z.output<typeof listFollowUpsSchema>;

const stageName = z
  .string({ error: "Please enter a name." })
  .trim()
  .min(1, "Please enter a name.")
  .max(60, "That name is too long.");

export const createStageSchema = z.object({
  name: stageName,
  position: z.number({ error: "Please give a position." }).int().min(0).max(100000),
});
export type CreateStageInput = z.output<typeof createStageSchema>;

export const updateStageSchema = z.object({
  name: stageName.optional(),
  position: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateStageInput = z.output<typeof updateStageSchema>;
