import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors/AppError";
import { assertCan } from "../assertCan";
import { can, checkAccess, type Access } from "../guard";
import { PERMISSION_CODES, type PermissionCode } from "../permissionRegistry";
import type { Principal } from "../principal";
import { resolveScope } from "../scope";

function principal(permissions: PermissionCode[], bypassesAccess = false): Principal {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    roleCode: bypassesAccess ? "SUPER_ADMIN" : "CUSTOM",
    bypassesAccess,
    permissions: new Set(permissions),
  };
}

const diag = "system:view-diagnostics" satisfies PermissionCode;
const reserved = "roles:manage" satisfies PermissionCode;

describe("can()", () => {
  it("allows a held permission and denies one that is not held", () => {
    expect(can(principal([diag]), diag)).toBe(true);
    expect(can(principal([]), diag)).toBe(false);
  });

  it("denies when there is no principal", () => {
    expect(can(null, diag)).toBe(false);
  });

  it("lets a bypass principal through every registered code, reserved ones included", () => {
    const superAdmin = principal([], true);
    for (const code of PERMISSION_CODES) expect(can(superAdmin, code), code).toBe(true);
  });
});

describe("checkAccess()", () => {
  const cases: Array<[string, Access | undefined, Principal | null, string]> = [
    ["public, anonymous", "public", null, "allow"],
    ["authenticated, anonymous", "authenticated", null, "unauthenticated"],
    ["authenticated, signed in", "authenticated", principal([]), "allow"],
    ["permission held", { permission: diag }, principal([diag]), "allow"],
    ["permission missing", { permission: diag }, principal([]), "forbidden"],
    ["permission, anonymous", { permission: diag }, null, "unauthenticated"],
    ["anyOf, one held", { anyOf: [reserved, diag] }, principal([diag]), "allow"],
    ["anyOf, none held", { anyOf: [reserved, diag] }, principal([]), "forbidden"],
    ["anyOf, empty list", { anyOf: [] }, principal([diag]), "forbidden"],
    ["reserved, bypass", { permission: reserved }, principal([], true), "allow"],
    ["missing access, signed in", undefined, principal([diag]), "forbidden"],
    ["missing access, anonymous", undefined, null, "forbidden"],
    [
      "unknown access shape",
      { nonsense: true } as unknown as Access,
      principal([diag]),
      "forbidden",
    ],
  ];

  it.each(cases)("%s → %s", (_label, access, who, expected) => {
    expect(checkAccess(access, who)).toBe(expected);
  });
});

describe("assertCan()", () => {
  it("returns quietly when allowed and throws FORBIDDEN with the code only in the log context", () => {
    expect(() => assertCan(principal([diag]), diag)).not.toThrow();
    try {
      assertCan(principal([]), diag);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).publicMessage).not.toContain(diag);
      expect((error as AppError).logContext).toMatchObject({ permission: diag });
    }
  });

  it("throws UNAUTHENTICATED without a principal", () => {
    expect(() => assertCan(null, diag)).toThrow(
      expect.objectContaining({ code: "UNAUTHENTICATED" }),
    );
  });
});

describe("resolveScope()", () => {
  const scopes = { own: diag, team: reserved, all: "users:manage-super-admins" } as const;

  it("returns 'all' for a bypass principal", () => {
    expect(resolveScope(principal([], true), scopes)).toBe("all");
  });

  it("returns the widest scope the principal holds, or 'none'", () => {
    expect(resolveScope(principal([diag]), scopes)).toBe("own");
    expect(resolveScope(principal([diag, reserved]), scopes)).toBe("team");
    expect(resolveScope(principal([]), scopes)).toBe("none");
    expect(resolveScope(null, scopes)).toBe("none");
  });
});
