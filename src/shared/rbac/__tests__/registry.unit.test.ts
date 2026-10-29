import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, SYSTEM_ROLE_CODES } from "../defaultRoles";
import { PERMISSION_CODES, PERMISSIONS, RESERVED_PERMISSION_CODES } from "../permissionRegistry";

describe("permission registry", () => {
  it("has unique resource:action codes, each with a label, description and module", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*$/);
      const entry = PERMISSIONS[code];
      expect(entry.label.trim().length, code).toBeGreaterThan(0);
      expect(entry.description.trim().length, code).toBeGreaterThan(0);
      expect(entry.module, code).toMatch(/^[a-z]+$/);
    }
  });

  it("registers system:view-diagnostics", () => {
    expect(PERMISSION_CODES).toContain("system:view-diagnostics");
  });

  it("reserves exactly roles:manage and users:manage-super-admins", () => {
    expect([...RESERVED_PERMISSION_CODES].sort()).toEqual([
      "roles:manage",
      "users:manage-super-admins",
    ]);
  });
});

describe("default roles", () => {
  it("defines the four system roles", () => {
    expect([...SYSTEM_ROLE_CODES].sort()).toEqual(["ADMIN", "AGENT", "MANAGER", "SUPER_ADMIN"]);
  });

  it("references only registered, non-reserved codes", () => {
    for (const code of SYSTEM_ROLE_CODES) {
      for (const permission of DEFAULT_ROLES[code].permissions) {
        expect(PERMISSION_CODES, `${code} -> ${permission}`).toContain(permission);
        expect(RESERVED_PERMISSION_CODES, `${code} -> ${permission}`).not.toContain(permission);
      }
    }
  });

  it("gives SUPER_ADMIN the bypass and an empty bundle, and nobody else the bypass", () => {
    expect(DEFAULT_ROLES.SUPER_ADMIN.bypassesAccess).toBe(true);
    expect(DEFAULT_ROLES.SUPER_ADMIN.permissions).toEqual([]);
    for (const code of ["ADMIN", "MANAGER", "AGENT"] as const) {
      expect(DEFAULT_ROLES[code].bypassesAccess).toBe(false);
    }
  });

  it("gives ADMIN system:view-diagnostics, and not MANAGER or AGENT", () => {
    expect(DEFAULT_ROLES.ADMIN.permissions).toContain("system:view-diagnostics");
    expect(DEFAULT_ROLES.MANAGER.permissions).not.toContain("system:view-diagnostics");
    expect(DEFAULT_ROLES.AGENT.permissions).not.toContain("system:view-diagnostics");
  });
});
