// Who is making this request? Phase 0 has no sign-in, so it resolves nobody. Phase 1 replaces the
// default with the session-based resolver. Tests may override it, but only when APP_ENV=test.
import { getEnv } from "@/shared/config/env";
import type { Principal } from "./principal";

export type PrincipalResolver = (request: Request) => Promise<Principal | null>;

const noPrincipal: PrincipalResolver = async () => null;
let testOverride: PrincipalResolver | null = null;

export function resolvePrincipal(request: Request): Promise<Principal | null> {
  return (testOverride ?? noPrincipal)(request);
}

/** Test-only: every request resolves through `resolver` (null restores the default). */
export function setPrincipalResolverForTests(resolver: PrincipalResolver | null): void {
  if (getEnv().APP_ENV !== "test") {
    throw new Error("setPrincipalResolverForTests may only be used when APP_ENV=test");
  }
  testOverride = resolver;
}
