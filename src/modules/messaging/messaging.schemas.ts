// Request shapes of the messaging API, with friendly messages.
import { z } from "zod";
import { TEMPLATE_CATEGORIES, WHATSAPP_TEXT_LIMIT } from "./messaging.types";

const clientRef = z
  .string({ error: "Please try again." })
  .trim()
  .min(1, "Please try again.")
  .max(64, "Please try again.");

export const sendTextSchema = z.object({
  body: z
    .string({ error: "Write a message first." })
    .trim()
    .min(1, "Write a message first.")
    .max(
      WHATSAPP_TEXT_LIMIT,
      "That's over WhatsApp's limit of 4096 characters. Please shorten it.",
    ),
  clientRef,
});
export type SendTextInput = z.output<typeof sendTextSchema>;

export const sendTemplateSchema = z.object({
  templateId: z
    .string({ error: "Please choose a template." })
    .trim()
    .min(1, "Please choose a template."),
  variables: z.array(z.string().trim().max(1024, "That's too long.")).max(50),
  clientRef,
});
export type SendTemplateInput = z.output<typeof sendTemplateSchema>;

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  unread: z.enum(["true", "false"]).optional(),
});
export type ListConversationsInput = z.output<typeof listConversationsSchema>;

const templateName = z
  .string({ error: "Please name this template." })
  .trim()
  .min(1, "Please name this template.")
  .max(120, "That name is too long.");
const templateBody = z
  .string({ error: "Write the message." })
  .trim()
  .min(1, "Write the message.")
  .max(1024, "WhatsApp allows up to 1024 characters in a template.");

export const createTemplateSchema = z.object({
  name: templateName,
  language: z
    .string({ error: "Please choose a language." })
    .trim()
    .min(2, "Please choose a language.")
    .max(10),
  category: z.enum(TEMPLATE_CATEGORIES, { error: "Please choose a category." }),
  body: templateBody,
});
export type CreateTemplateInput = z.output<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  body: templateBody,
  category: z.enum(TEMPLATE_CATEGORIES, { error: "Please choose a category." }).optional(),
});
export type UpdateTemplateInput = z.output<typeof updateTemplateSchema>;

export const listTemplatesSchema = z.object({ approved: z.enum(["true", "false"]).optional() });
export type ListTemplatesInput = z.output<typeof listTemplatesSchema>;
