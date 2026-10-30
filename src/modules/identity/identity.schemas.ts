// Request shapes of the user API, with friendly messages. Unknown fields are stripped, so an
// ordinary edit can never reach the password, lock or status columns.
import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email is too long.")
  .pipe(z.email("Please enter a valid email address."));
const name = z.string().trim().min(1, "Please enter a name.").max(200, "That name is too long.");
const phoneE164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Please enter the phone number with its country code, like +91…");
const roleCode = z.string().trim().min(1, "Please choose a role.");
const password = z.string().min(1, "Please enter a password.");

export const createUserSchema = z.object({
  email,
  name,
  phoneE164: phoneE164.nullish(),
  password,
  roleCode,
});
export type CreateUserInput = z.output<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: email.optional(),
  name: name.optional(),
  phoneE164: phoneE164.nullable().optional(),
  roleCode: roleCode.optional(),
});
export type UpdateUserInput = z.output<typeof updateUserSchema>;

export const setPasswordSchema = z.object({ password });
export type SetPasswordInput = z.output<typeof setPasswordSchema>;

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListUsersInput = z.output<typeof listUsersSchema>;
