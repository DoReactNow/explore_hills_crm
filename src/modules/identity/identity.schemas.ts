// Request shapes of the user API, with friendly messages. Unknown fields are stripped, so an
// ordinary edit can never reach the password, lock or status columns.
import { z } from "zod";
import { IDENTITY_USER_STATUSES } from "./identity.types";

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

const uuidList = z.array(z.string().trim().min(1)).max(100, "That's too many teams.");

export const updateUserSchema = z.object({
  email: email.optional(),
  name: name.optional(),
  phoneE164: phoneE164.nullable().optional(),
  roleCode: roleCode.optional(),
  managerId: z.string().trim().min(1).nullable().optional(),
  teamIds: uuidList.optional(),
});
export type UpdateUserInput = z.output<typeof updateUserSchema>;

export const setPasswordSchema = z.object({ password });
export type SetPasswordInput = z.output<typeof setPasswordSchema>;

export const USER_SORTS = ["name", "role", "team", "manager", "status", "lastLoginAt"] as const;

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(200).optional(),
  roleCode: z.string().trim().max(64).optional(),
  teamId: z.string().trim().max(64).optional(),
  status: z.enum(IDENTITY_USER_STATUSES).optional(),
  sort: z.enum(USER_SORTS).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export type ListUsersInput = z.output<typeof listUsersSchema>;

// No format or length rules here: a sign-in attempt learns nothing except "that didn't match".
export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Please enter your email."),
  password: z.string().min(1, "Please enter your password."),
});
export type SignInInput = z.output<typeof signInSchema>;

const teamName = z
  .string()
  .trim()
  .min(1, "Please enter a team name.")
  .max(120, "That name is too long.");

export const createTeamSchema = z.object({
  name: teamName,
  managerUserId: z.string().trim().min(1).nullish(),
});
export type CreateTeamInput = z.output<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: teamName.optional(),
  managerUserId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateTeamInput = z.output<typeof updateTeamSchema>;

export const teamMemberSchema = z.object({
  userId: z.string().trim().min(1, "Please choose a person."),
});
export type TeamMemberInput = z.output<typeof teamMemberSchema>;

const roleName = z
  .string()
  .trim()
  .min(1, "Please enter a role name.")
  .max(80, "That name is too long.");
const roleVersion = z.iso.datetime({ error: "Please refresh and try again." });

export const createRoleSchema = z.object({
  name: roleName,
  description: z.string().trim().max(300, "That description is too long.").nullish(),
  copyFromCode: z.string().trim().min(1).nullish(),
});
export type CreateRoleInput = z.output<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: roleName.optional(),
  permissions: z.array(z.string().trim().min(1)).max(500).optional(),
  version: roleVersion,
});
export type UpdateRoleInput = z.output<typeof updateRoleSchema>;

export const resetRoleSchema = z.object({ version: roleVersion });
export type ResetRoleInput = z.output<typeof resetRoleSchema>;
