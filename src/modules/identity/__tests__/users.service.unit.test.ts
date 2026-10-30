import { describe, expect, it, vi } from "vitest";
import { createTestClock } from "@/shared/time";
import type { Principal } from "@/shared/rbac/principal";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import { createUserService, type UserRepository } from "../identity.users.service";

const SELF = "0190a000-0000-7000-8000-000000000001";
const OTHER = "0190a000-0000-7000-8000-000000000002";
const STRONG = "Correct-Horse-Battery-9";
const ROLES = {
  SUPER_ADMIN: { id: "r-super", code: "SUPER_ADMIN", name: "Super Admin", bypassesAccess: true },
  ADMIN: { id: "r-admin", code: "ADMIN", name: "Admin", bypassesAccess: false },
  AGENT: { id: "r-agent", code: "AGENT", name: "Agent", bypassesAccess: false },
};

const admin: Principal = {
  userId: SELF,
  roleCode: "ADMIN",
  bypassesAccess: false,
  permissions: new Set<PermissionCode>([
    "users:view",
    "users:create",
    "users:edit",
    "users:deactivate",
  ]),
};
const superAdmin: Principal = {
  ...admin,
  roleCode: "SUPER_ADMIN",
  bypassesAccess: true,
  permissions: new Set(),
};
const viewer: Principal = { ...admin, permissions: new Set<PermissionCode>(["users:view"]) };

function target(role: keyof typeof ROLES = "AGENT", status = "ACTIVE") {
  return {
    id: OTHER,
    email: "t@example.com",
    name: "Tara Singh",
    phoneE164: null,
    status,
    role: ROLES[role],
  };
}

function setup(existing = target(), activeSuperAdmins = 2) {
  const repository = {
    transaction: vi.fn((work: (tx: never) => unknown) => work({} as never)),
    lockUserChanges: vi.fn(async () => undefined),
    findRoleByCode: vi.fn(
      async (_tx: unknown, code: string) => ROLES[code as keyof typeof ROLES] ?? null,
    ),
    findUserForChange: vi.fn(async () => existing),
    countActiveSuperAdmins: vi.fn(async () => activeSuperAdmins),
    insertUser: vi.fn(async (_tx: unknown, data: { email: string }) => ({
      id: OTHER,
      email: data.email,
    })),
    updateUser: vi.fn(async () => ({ id: OTHER })),
    revokeSessions: vi.fn(async () => undefined),
    listUsers: vi.fn(async () => ({ items: [], total: 0 })),
    getUser: vi.fn(async () => existing),
  };
  const recordAudit = vi.fn(async () => undefined);
  const hashPassword = vi.fn(async () => "$argon2id$hash");
  const service = createUserService({
    repository: repository as unknown as UserRepository,
    recordAudit,
    hashPassword,
    clock: createTestClock("2026-10-30T10:00:00.000Z"),
  });
  return { service, repository, recordAudit, hashPassword };
}

const ctx = (principal: Principal) => ({ principal, requestId: "req-1" });
const newUser = { email: "New@Example.com", name: "Asha Rao", password: STRONG, roleCode: "AGENT" };
const FORBIDDEN = { code: "FORBIDDEN" };
const CONFLICT = { code: "CONFLICT" };

describe("createUser", () => {
  it("normalises the email, hashes the password and audits without it (P1-USER-01, P1-PASS-07)", async () => {
    const { service, repository, recordAudit, hashPassword } = setup();
    await service.createUser(ctx(admin), newUser);
    expect(hashPassword).toHaveBeenCalledWith(STRONG);
    expect(repository.insertUser.mock.calls[0][1]).toMatchObject({
      email: "new@example.com",
      passwordHash: "$argon2id$hash",
      status: "ACTIVE",
      roleId: "r-agent",
    });
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain(STRONG);
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("$argon2id$hash");
  });

  it("refuses a weak password or one holding the user's name (P1-PASS-02, -03)", async () => {
    const { service, hashPassword } = setup();
    for (const password of ["weak", "Asha-Hills-2026!"]) {
      await expect(service.createUser(ctx(admin), { ...newUser, password })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("refuses a role that does not exist (P1-USER-05)", async () => {
    const { service } = setup();
    await expect(
      service.createUser(ctx(admin), { ...newUser, roleCode: "NOPE" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("lets only a Super Admin give the Super Admin role (P1-SUPER-01, -03)", async () => {
    const { service } = setup();
    const input = { ...newUser, roleCode: "SUPER_ADMIN" };
    await expect(service.createUser(ctx(admin), input)).rejects.toMatchObject(FORBIDDEN);
    await expect(service.createUser(ctx(superAdmin), input)).resolves.toBeTruthy();
  });

  it("refuses someone without the permission, even past the route guard", async () => {
    const { service } = setup();
    await expect(service.createUser(ctx(viewer), newUser)).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("an Admin and a Super Admin account (P1-SUPER-01)", () => {
  const actions = {
    edit: (s: ReturnType<typeof setup>["service"], c: ReturnType<typeof ctx>) =>
      s.updateUser(c, OTHER, { name: "New Name" }),
    "change role": (s: ReturnType<typeof setup>["service"], c: ReturnType<typeof ctx>) =>
      s.updateUser(c, OTHER, { roleCode: "AGENT" }),
    deactivate: (s: ReturnType<typeof setup>["service"], c: ReturnType<typeof ctx>) =>
      s.deactivateUser(c, OTHER),
    "set password": (s: ReturnType<typeof setup>["service"], c: ReturnType<typeof ctx>) =>
      s.setPassword(c, OTHER, { password: STRONG }),
  };

  it.each(Object.entries(actions))("an Admin cannot %s", async (_name, act) => {
    const { service, repository } = setup(target("SUPER_ADMIN"));
    await expect(act(service, ctx(admin))).rejects.toMatchObject(FORBIDDEN);
    expect(repository.updateUser).not.toHaveBeenCalled();
  });

  it.each(Object.entries(actions))("a Super Admin can %s (P1-SUPER-03)", async (_name, act) => {
    const { service, repository, recordAudit } = setup(target("SUPER_ADMIN"));
    await act(service, ctx(superAdmin));
    expect(repository.updateUser).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalled(); // P1-SUPER-07
  });

  it("an Admin cannot reactivate a deactivated Super Admin", async () => {
    const { service } = setup(target("SUPER_ADMIN", "DEACTIVATED"));
    await expect(service.reactivateUser(ctx(admin), OTHER)).rejects.toMatchObject(FORBIDDEN);
  });

  it("an Admin cannot promote someone to Super Admin", async () => {
    const { service } = setup();
    await expect(
      service.updateUser(ctx(admin), OTHER, { roleCode: "SUPER_ADMIN" }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("the last active Super Admin (P1-SUPER-04)", () => {
  it("cannot be deactivated", async () => {
    const { service } = setup(target("SUPER_ADMIN"), 1);
    await expect(service.deactivateUser(ctx(superAdmin), OTHER)).rejects.toMatchObject(CONFLICT);
  });

  it("cannot be demoted", async () => {
    const { service } = setup(target("SUPER_ADMIN"), 1);
    await expect(
      service.updateUser(ctx(superAdmin), OTHER, { roleCode: "AGENT" }),
    ).rejects.toMatchObject(CONFLICT);
  });

  it("can go when another remains", async () => {
    const { service } = setup(target("SUPER_ADMIN"), 2);
    await expect(service.deactivateUser(ctx(superAdmin), OTHER)).resolves.toBeTruthy();
  });

  it("a deactivated Super Admin is not counted against the limit (P1-SUPER-06)", async () => {
    const { service } = setup(target("SUPER_ADMIN", "DEACTIVATED"), 1);
    await expect(
      service.updateUser(ctx(superAdmin), OTHER, { roleCode: "AGENT" }),
    ).resolves.toBeTruthy();
  });
});

describe("your own account (P1-USER-10, P1-PASS-08)", () => {
  const own = () => ({ ...target("ADMIN"), id: SELF });

  it("you can edit your name", async () => {
    const { service } = setup(own());
    await expect(service.updateUser(ctx(admin), SELF, { name: "New Name" })).resolves.toBeTruthy();
  });

  it("you cannot change your role, deactivate yourself or set your password", async () => {
    const { service, repository } = setup(own());
    await expect(service.updateUser(ctx(admin), SELF, { roleCode: "AGENT" })).rejects.toMatchObject(
      FORBIDDEN,
    );
    await expect(service.deactivateUser(ctx(admin), SELF)).rejects.toMatchObject(FORBIDDEN);
    await expect(service.setPassword(ctx(admin), SELF, { password: STRONG })).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(repository.updateUser).not.toHaveBeenCalled();
  });
});

describe("repeating an action (X-RACE-01)", () => {
  it("deactivating twice writes nothing the second time", async () => {
    const { service, repository, recordAudit } = setup(target("AGENT", "DEACTIVATED"));
    await service.deactivateUser(ctx(admin), OTHER);
    expect(repository.updateUser).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("an edit that changes nothing writes nothing", async () => {
    const { service, repository, recordAudit } = setup();
    await service.updateUser(ctx(admin), OTHER, { name: "Tara Singh", roleCode: "AGENT" });
    expect(repository.updateUser).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("a malformed ID (X-INPUT-07)", () => {
  it("is not found", async () => {
    const { service, repository } = setup();
    await expect(service.deactivateUser(ctx(admin), "not-a-uuid")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.getUser(ctx(admin), "not-a-uuid")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repository.getUser).not.toHaveBeenCalled();
  });
});
