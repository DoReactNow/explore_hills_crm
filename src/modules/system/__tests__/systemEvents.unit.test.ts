import { describe, expect, it } from "vitest";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { assembleEventTypes, shouldDeliver } from "@/shared/realtime/eventTypes";
import { systemEventTypes } from "../system.events";

const who = (permissions: PermissionCode[], bypassesAccess = false): Principal => ({
  userId: "u",
  roleCode: "X",
  bypassesAccess,
  permissions: new Set(permissions),
});
const types = assembleEventTypes({ system: systemEventTypes });
const notice = { type: "system.workerStatusChanged", payload: { workerId: "host:1" } };

describe("system.workerStatusChanged", () => {
  it("reaches principals who may view diagnostics, including the Super Admin", async () => {
    await expect(shouldDeliver(types, who(["system:view-diagnostics"]), notice)).resolves.toBe(
      true,
    );
    await expect(shouldDeliver(types, who([], true), notice)).resolves.toBe(true);
  });

  it("does not reach anyone else", async () => {
    await expect(shouldDeliver(types, who([]), notice)).resolves.toBe(false);
  });
});
