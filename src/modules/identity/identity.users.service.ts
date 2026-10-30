// User rules: creating, editing, deactivating and setting passwords, with the Super Admin
// protections of Decision 23 and the password rules of Decision 48. Every change is audited in the
// same transaction. Services call assertCan as well as the route guard (project_data.md 5.2 rule 5).
import { recordAudit, type AuditAction, type AuditInput, type AuditTx } from "@/modules/audit";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { resolveScope, type ScopePermissions } from "@/shared/rbac/scope";
import { systemClock, type Clock } from "@/shared/time";
import { assertPasswordStrength, hashPassword } from "./identity.passwords";
import { isUuid, type UserContext } from "./identity.context";
import type { Tx } from "./identity.repository";
import type {
  CreateUserInput,
  ListUsersInput,
  SetPasswordInput,
  UpdateUserInput,
} from "./identity.schemas";
import {
  userRepository,
  toUserView,
  type PublicUser,
  type RoleForChange,
  type UserChanges,
  type UserRepository,
} from "./identity.users.repository";

export type { UserRepository };

export type { UserContext };

const USER_SCOPE: ScopePermissions = {
  own: "users:view",
  team: "users:view",
  all: "users:view-all",
};

interface UserServiceDeps {
  repository?: UserRepository;
  recordAudit?: (tx: AuditTx, input: AuditInput) => Promise<void>;
  hashPassword?: (password: string) => Promise<string>;
  clock?: Clock;
}

const MANAGE_SUPER_ADMINS: PermissionCode = "users:manage-super-admins";

const assertUuid = (id: string): void => {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
};

const unknownRole = () =>
  new AppError("VALIDATION_FAILED", {
    fieldErrors: [{ field: "roleCode", message: "Please choose a role from the list." }],
  });

const refuseOwnAccount = (principal: Principal, action: string) =>
  new AppError("FORBIDDEN", {
    logContext: { rule: `own-account:${action}`, principalId: principal.userId },
  });

const fieldConflict = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });

/** A manager with people or teams depending on them must hand those over first (Decision 55). */
const stillSupervising = () =>
  new AppError("CONFLICT", {
    fieldErrors: [
      {
        field: "_root",
        message: "This person still manages people or a team. Move those to someone else first.",
      },
    ],
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

  const visibleIds = async (principal: Principal): Promise<string[] | "all"> =>
    resolveScope(principal, USER_SCOPE) === "all"
      ? "all"
      : repository.visibleUserIds(principal.userId);

  /** Tells the screen whether to offer edit controls; the server refuses them either way. */
  const withAccess = (principal: Principal, user: PublicUser) => ({
    ...toUserView(user),
    canManage: !user.role.bypassesAccess || can(principal, MANAGE_SUPER_ADMINS),
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

  /** Called with the user-changes lock held, so two changes cannot form a loop between them. */
  async function assertValidManager(tx: Tx, userId: string, managerId: string | null) {
    if (managerId === null) return;
    if (managerId === userId) throw fieldConflict("managerId", "A person can't manage themselves.");
    const invalid = () => fieldConflict("managerId", "Please choose an active person as manager.");
    if (!isUuid(managerId)) throw invalid();
    const manager = await repository.findUserForChange(tx, managerId);
    if (manager?.status !== "ACTIVE") throw invalid();
    if (await repository.reportsTo(tx, managerId, userId)) {
      throw fieldConflict("managerId", "That person already reports to this one.");
    }
  }

  return {
    async listUsers({ principal }: UserContext, input: ListUsersInput) {
      assertCan(principal, "users:view");
      const { page, pageSize, ...filters } = input;
      const { items, total, statusCounts } = await repository.listUsers({
        ...filters,
        skip: (page - 1) * pageSize,
        take: pageSize,
        visibleIds: await visibleIds(principal),
      });
      return {
        items: items.map((user) => withAccess(principal, user)),
        total,
        page,
        pageSize,
        statusCounts,
      };
    },

    async getUser({ principal }: UserContext, id: string) {
      assertCan(principal, "users:view");
      assertUuid(id);
      const visible = await visibleIds(principal);
      // Out of scope looks exactly like not found (X-ACCESS-05).
      if (visible !== "all" && !visible.includes(id)) throw new AppError("NOT_FOUND");
      const user = await repository.getUser(id);
      if (!user) throw new AppError("NOT_FOUND");
      return withAccess(principal, user);
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
        let teamsChanged = false;
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

        if (input.managerId !== undefined && input.managerId !== target.managerId) {
          await assertValidManager(tx, id, input.managerId);
          changes.managerId = input.managerId;
          await writeAudit(tx, context, "user.manager_changed", id, "User manager changed", {
            fromManagerId: target.managerId,
            toManagerId: input.managerId,
          });
        }

        if (input.teamIds !== undefined) {
          const wanted = [...new Set(input.teamIds)].sort();
          const current = target.teamMemberships.map((row) => row.teamId).sort();
          if (wanted.join() !== current.join()) {
            const known = await repository.existingTeamIds(tx, wanted.filter(isUuid));
            if (known.length !== wanted.length) {
              throw fieldConflict("teamIds", "One of those teams no longer exists.");
            }
            await repository.setTeams(tx, id, wanted);
            teamsChanged = true;
            await writeAudit(tx, context, "user.teams_changed", id, "User teams changed", {
              teamIds: wanted,
            });
          }
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

        if (Object.keys(changes).length === 0 && !teamsChanged) {
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

    /** `alsoDo` lets another module act in the same transaction, such as moving the person's leads. */
    async deactivateUser(
      context: UserContext,
      id: string,
      alsoDo?: (tx: Tx) => Promise<void>,
    ): Promise<PublicUser> {
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
        const { reports, teams } = await repository.supervisionOf(tx, id);
        if (reports + teams > 0) throw stillSupervising();
        await alsoDo?.(tx);

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
