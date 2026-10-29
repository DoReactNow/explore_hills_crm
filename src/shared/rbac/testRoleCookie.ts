// TEST-ONLY sign-in for the E2E specs: the eh_test_role cookie makes the server act as that role,
// using the role's real grants. It can only be installed when APP_ENV=test (W-008 part B).
import { randomUUID } from "node:crypto";
import { getEnv } from "@/shared/config/env";
import type { Principal } from "./principal";
import { configurePrincipalResolver, type PrincipalResolver } from "./principalResolver";

export const TEST_ROLE_COOKIE = "eh_test_role";
const ROLE_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

export type RolePrincipalLoader = (roleCode: string, userId: string) => Promise<Principal>;

function readCookie(headers: Headers, name: string): string | undefined {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function createTestRoleCookieResolver(loader: RolePrincipalLoader): PrincipalResolver {
  return async ({ headers }) => {
    const role = readCookie(headers, TEST_ROLE_COOKIE);
    if (!role || !ROLE_CODE.test(role)) return null;
    try {
      return await loader(role, randomUUID());
    } catch {
      return null;
    }
  };
}

export function installTestRoleCookieResolver(loader: RolePrincipalLoader): void {
  if (getEnv().APP_ENV !== "test") {
    throw new Error("The test role cookie may only be installed when APP_ENV=test");
  }
  configurePrincipalResolver(createTestRoleCookieResolver(loader));
}
