// Test principals (W-005, W-008 part B). Each is built from the role's grants in the test database
// through the same identity code the real resolver will use, so tests see real permissions.
import { randomUUID } from "node:crypto";
import { buildPrincipalForRole } from "@/modules/identity";
import type { Principal } from "@/shared/rbac/principal";
import { setPrincipalResolverForTests } from "@/shared/rbac/principalResolver";

export type TestRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "AGENT";

export function testPrincipal(
  roleCode: TestRole | string,
  userId: string = randomUUID(),
): Promise<Principal> {
  return buildPrincipalForRole(roleCode, userId);
}

/** Every following route() call in this test process resolves to this principal (null = signed out). */
export function actAs(principal: Principal | null): void {
  setPrincipalResolverForTests(async () => principal);
}

export function stopActing(): void {
  setPrincipalResolverForTests(null);
}
