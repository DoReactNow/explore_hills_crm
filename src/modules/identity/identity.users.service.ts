// User rules: creating, editing, deactivating and setting passwords, with the Super Admin
// protections of Decision 23 and the password rules of Decision 48. Every change is audited in the
// same transaction. Services call assertCan as well as the route guard (project_data.md 5.2 rule 5).
import { recordAudit, type AuditAction, type AuditInput, type AuditTx } from "@/modules/audit";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { systemClock, type Clock } from "@/shared/time";
import { assertPasswordStrength, hashPassword } from "./identity.passwords";
import type { Tx } from "./identity.repository";
import type {
  CreateUserInput,
  ListUsersInput,
  SetPasswordInput,
  UpdateUserInput,
} from "./identity.schemas";
import {
  userRepository,
  type PublicUser,
  type RoleForChange,
  type UserChanges,
  type UserRepository,
} from "./identity.users.repository";

export type { UserRepository };

export interface UserContext {
  principal: Principal;
  requestId?: string;
}

interface UserServiceDeps {
  repository?: UserRepository;
  recordAudit?: (tx: AuditTx, input: AuditInput) => Promise<void>;
  hashPassword?: (password: string) => Promise<string>;
  clock?: Clock;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGE_SUPER_ADMINS: PermissionCode = "users:manage-super-admins";

const assertUuid = (id: string): void => {
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
};

const unknownRole = () =>
  new AppError("VALIDATION_FAILED", {
    fieldErrors: [{ field: "roleCode", message: "Please choose a role from the list." }],
  });

const refuseOwnAccount = (principal: Principal, action: string) =>
  new AppError("FORBIDDEN", {
    logContext: { rule: `own-account:${action}`, principalId: principal.userId },
  });

const lastSuperAdmin = () =>
  new AppError("CONFLICT", {
    fieldErrors: [
      { field: "_root", message: "The company needs at least one active Super Admin." },
    ],
  });

export function createUserService(deps: UserServiceDeps = {}) {
  const repository = deps.repository ?? userRepository;
  const audit = deps.recordAudit ?? recordAudit;
  const hash = deps.hashPassword ?? hashPassword;
  const clock = deps.clock ?? systemClock;

  const writeAudit = (
    tx: Tx,
    { principal, requestId }: UserContext,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    audit(tx, {
      action,
      entityType: "user",
      entityId,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  /** Only someone holding the reserved code may touch a Super Admin account or hand out that role. */
  const assertMayTouch = (principal: Principal, role: Pick<RoleForChange, "bypassesAccess">) => {
    if (role.bypassesAccess) assertCan(principal, MANAGE_SUPER_ADMINS);
  };

  async function loadTarget(tx: Tx, principal: Principal, id: string) {
    const target = await repository.findUserForChange(tx, id);
    if (!target) throw new AppError("NOT_FOUND");
    assertMayTouch(principal, target.role);
    return target;
  }

  /** Call with the user-changes lock held, before removing an active Super Admin. */
  async function assertNotLastSuperAdmin(
    tx: Tx,
    target: { status: string; role: Pick<RoleForChange, "bypassesAccess"> },
  ) {
    if (target.status !== "ACTIVE" || !target.role.bypassesAccess) return;
    if ((await repository.countActiveSuperAdmins(tx)) <= 1) throw lastSuperAdmin();
  }

  return {
    async listUsers({ principal }: UserContext, { page, pageSize }: ListUsersInput) {
      assertCan(principal, "users:view");
      const { items, total } = await repository.listUsers((page - 1) * pageSize, pageSize);
      return { items, total, page, pageSize };
    },

    async getUser({ principal }: UserContext, id: string): Promise<PublicUser> {
      assertCan(principal, "users:view");
      assertUuid(id);
      const user = await repository.getUser(id);
      if (!user) throw new AppError("NOT_FOUND");
      return user;
    },

    /** The signed-in person's own profile; needs no permission. */
    async getOwnProfile({ principal }: UserContext): Promise<PublicUser> {
      const user = await repository.getUser(principal.userId);
      if (!user) throw new AppError("UNAUTHENTICATED");
      return user;
    },

    async createUser(context: UserContext, input: CreateUserInput): Promise<PublicUser> {
      const { principal } = context;
      assertCan(principal, "users:create");
      const email = input.email.trim().toLowerCase();

      const role = await repository.transaction((tx) =>
        repository.findRoleByCode(tx, input.roleCode),
      );
      if (!role) throw unknownRole();
      assertMayTouch(principal, role);

      assertPasswordStrength(input.password, { email, name: input.name });
      const passwordHash = await hash(input.password);

      return repository.transaction(async (tx) => {
        const user = await repository.insertUser(tx, {
          email,
          name: input.name,
          phoneE164: input.phoneE164 ?? null,
          passwordHash,
          status: "ACTIVE",
          roleId: role.id,
        });
        await writeAudit(tx, context, "user.created", user.id, "User created", {
          role: role.code,
        });
        return user;
      });
    },

    async updateUser(
      context: UserContext,
      id: string,
      input: UpdateUserInput,
    ): Promise<PublicUser> {
      const { principal } = context;
      assertCan(principal, "users:edit");
      assertUuid(id);

      return repository.transaction(async (tx) => {
        await repository.lockUserChanges(tx);
        const target = await loadTarget(tx, principal, id);

        const changes: UserChanges = {};
        const changed: string[] = [];
        if (input.email !== undefined && input.email !== target.email) {
          changes.email = input.email;
          changed.push("email");
        }
        if (input.name !== undefined && input.name !== target.name) {
          changes.name = input.name;
          changed.push("name");
        }
        if (input.phoneE164 !== undefined && input.phoneE164 !== target.phoneE164) {
          changes.phoneE164 = input.phoneE164;
          changed.push("phoneE164");
        }

        let newRole: RoleForChange | null = null;
        if (input.roleCode !== undefined && input.roleCode !== target.role.code) {
          if (id === principal.userId) throw refuseOwnAccount(principal, "role");
          newRole = await repository.findRoleByCode(tx, input.roleCode);
          if (!newRole) throw unknownRole();
          assertMayTouch(principal, newRole);
          if (!newRole.bypassesAccess) await assertNotLastSuperAdmin(tx, target);
          changes.roleId = newRole.id;
        }

        if (Object.keys(changes).length === 0) {
          const unchanged = await repository.getUser(id);
          if (!unchanged) throw new AppError("NOT_FOUND");
          return unchanged;
        }

        const user = await repository.updateUser(tx, id, changes);
        if (changed.length > 0) {
          await writeAudit(tx, context, "user.updated", id, "User details updated", { changed });
        }
        if (newRole) {
          await writeAudit(tx, context, "user.role_changed", id, "User role changed", {
            fromRole: target.role.code,
            toRole: newRole.code,
          });
        }
        return user;
      });
    },

    async deactivateUser(context: UserContext, id: string): Promise<PublicUser> {
      const { principal } = context;
      assertCan(principal, "users:deactivate");
      assertUuid(id);

      return repository.transaction(async (tx) => {
        await repository.lockUserChanges(tx);
        const target = await loadTarget(tx, principal, id);
        if (id === principal.userId) throw refuseOwnAccount(principal, "deactivate");
        if (target.status === "DEACTIVATED") {
          const unchanged = await repository.getUser(id);
          if (!unchanged) throw new AppError("NOT_FOUND");
          return unchanged;
        }
        await assertNotLastSuperAdmin(tx, target);

        const now = clock.now();
        const user = await repository.updateUser(tx, id, {
          status: "DEACTIVATED",
          deactivatedAt: now,
        });
        await repository.revokeSessions(tx, id, now);
        await writeAudit(tx, context, "user.deactivated", id, "User deactivated");
        return user;
      });
    },

    async reactivateUser(context: UserContext, id: string): Promise<PublicUser> {
      const { principal } = context;
      assertCan(principal, "users:deactivate");
      assertUuid(id);

      return repository.transaction(async (tx) => {
        await repository.lockUserChanges(tx);
        const target = await loadTarget(tx, principal, id);
        if (target.status !== "DEACTIVATED") {
          const unchanged = await repository.getUser(id);
          if (!unchanged) throw new AppError("NOT_FOUND");
          return unchanged;
        }
        const user = await repository.updateUser(tx, id, {
          status: "ACTIVE",
          deactivatedAt: null,
        });
        await writeAudit(tx, context, "user.reactivated", id, "User reactivated");
        return user;
      });
    },

    /** Only someone else may set a password (Decision 48); it ends all that user's sessions. */
    async setPassword(
      context: UserContext,
      id: string,
      input: SetPasswordInput,
    ): Promise<PublicUser> {
      const { principal } = context;
      assertCan(principal, "users:edit");
      assertUuid(id);

      // Checked before the slow hash, and again under the lock in case the account has changed.
      const before = await repository.transaction((tx) => loadTarget(tx, principal, id));
      if (id === principal.userId) throw refuseOwnAccount(principal, "password");
      assertPasswordStrength(input.password, { email: before.email, name: before.name });
      const passwordHash = await hash(input.password);

      return repository.transaction(async (tx) => {
        await repository.lockUserChanges(tx);
        await loadTarget(tx, principal, id);
        const user = await repository.updateUser(tx, id, {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        });
        await repository.revokeSessions(tx, id, clock.now());
        await writeAudit(tx, context, "user.password_changed", id, "User password changed");
        return user;
      });
    },
  };
}

export const userService = createUserService();
