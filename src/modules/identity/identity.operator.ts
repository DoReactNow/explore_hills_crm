// Accounts made without a signed-in person: seeds and the private recovery command (Decision 49).
// They follow the same password rule as the app and are audited as system actions. Nothing here
// is reachable from a web route. Errors never contain a password.
import { recordAudit } from "@/modules/audit";
import { systemClock } from "@/shared/time";
import { assertPasswordStrength, hashPassword } from "./identity.passwords";
import type { IdentityUserStatus } from "./identity.types";
import { userRepository } from "./identity.users.repository";

export interface OperatorTarget {
  APP_ENV: string;
  databaseName: string;
}

export function assertOperatorTarget({ APP_ENV, databaseName }: OperatorTarget): void {
  if (APP_ENV === "test" || databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run: this command is for a real database, not a test one (APP_ENV=${APP_ENV}, database "${databaseName}").`,
    );
  }
}

function assertStrong(password: string, owner: { email: string; name?: string }): void {
  try {
    assertPasswordStrength(password, owner);
  } catch {
    throw new Error(
      "The password is too weak: at least 12 characters, three of lowercase, uppercase, digits and symbols, no common words, and not containing the person's name or email.",
    );
  }
}

const normalise = (email: string) => email.trim().toLowerCase();

export interface SeedUser {
  email: string;
  name: string;
  password: string;
  roleCode: string;
  status?: IdentityUserStatus;
}

/** Creates the user unless the email exists. Returns whether it did. */
export async function createUserIfMissing(input: SeedUser): Promise<boolean> {
  const email = normalise(input.email);
  assertStrong(input.password, { email, name: input.name });
  if (await userRepository.findUserByEmail(email)) return false;
  const passwordHash = await hashPassword(input.password);
  return userRepository.transaction(async (tx) => {
    const role = await userRepository.findRoleByCode(tx, input.roleCode);
    if (!role) throw new Error(`Role "${input.roleCode}" does not exist; run db:sync-rbac first.`);
    const user = await userRepository.insertUser(tx, {
      email,
      name: input.name,
      phoneE164: null,
      passwordHash,
      status: input.status ?? "ACTIVE",
      roleId: role.id,
    });
    await recordAudit(tx, {
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      summary: "User created by a seed",
      actor: null,
      metadata: { role: role.code },
    });
    return true;
  });
}

/** Creates the first Super Admin, only when no active one exists (Decision 49). */
export async function ensureFirstSuperAdmin(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<"created" | "exists"> {
  const email = normalise(input.email);
  const name = input.name ?? "Super Admin";
  assertStrong(input.password, { email });
  const active = await userRepository.transaction((tx) =>
    userRepository.countActiveSuperAdmins(tx),
  );
  if (active > 0) return "exists";
  if (await userRepository.findUserByEmail(email)) {
    throw new Error(
      "That email already belongs to another account. Set SEED_SUPER_ADMIN_EMAIL to a different one, or use the recovery command if it is a deactivated Super Admin you want back.",
    );
  }
  const superAdminRole = await userRepository.findBypassRoleCode();
  if (!superAdminRole)
    throw new Error("The Super Admin role does not exist; run db:sync-rbac first.");
  await createUserIfMissing({ email, name, password: input.password, roleCode: superAdminRole });
  return "created";
}

/** The private recovery command's work: sets a Super Admin's password and signs them out. */
export async function resetSuperAdminPassword(input: {
  email: string;
  password: string;
}): Promise<void> {
  const email = normalise(input.email);
  const notFound = () => new Error("There is no Super Admin account with that email.");
  const before = await userRepository.findUserByEmail(email);
  if (!before?.role.bypassesAccess) throw notFound();
  assertStrong(input.password, { email, name: before.name });
  const passwordHash = await hashPassword(input.password);

  await userRepository.transaction(async (tx) => {
    await userRepository.lockUserChanges(tx);
    const target = await userRepository.findUserForChange(tx, before.id);
    if (!target?.role.bypassesAccess) throw notFound();
    await userRepository.updateUser(tx, target.id, {
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    await userRepository.revokeSessions(tx, target.id, systemClock.now());
    await recordAudit(tx, {
      action: "user.password_changed",
      entityType: "user",
      entityId: target.id,
      summary: "Super Admin password reset by the operator command",
      actor: null,
    });
  });
}
