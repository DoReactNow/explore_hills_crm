// Who is making this request? The composition root (src/instrumentation.ts) configures the
// resolver at server start: nothing in Phase 0 outside tests, the session resolver from Phase 1.
// Integration tests may override it in-process, but only when APP_ENV=test.
import { getEnv } from "@/shared/config/env";
import type { Principal } from "./principal";

/** Anything with request headers: a route's Request, or a page's headers(). */
export interface PrincipalRequest {
  headers: Headers;
}

export type PrincipalResolver = (request: PrincipalRequest) => Promise<Principal | null>;

const noPrincipal: PrincipalResolver = async () => null;

// Kept on globalThis: Next.js loads instrumentation and route code in separate bundles, which
// would otherwise each get their own copy of this module.
const holder = globalThis as unknown as { explorehillsPrincipalResolver?: PrincipalResolver };
let testOverride: PrincipalResolver | null = null;

export function configurePrincipalResolver(resolver: PrincipalResolver): void {
  holder.explorehillsPrincipalResolver = resolver;
}

export function resolvePrincipal(request: PrincipalRequest): Promise<Principal | null> {
  return (testOverride ?? holder.explorehillsPrincipalResolver ?? noPrincipal)(request);
}

/** Test-only: every request resolves through `resolver` (null restores the configured one). */
export function setPrincipalResolverForTests(resolver: PrincipalResolver | null): void {
  if (getEnv().APP_ENV !== "test") {
    throw new Error("setPrincipalResolverForTests may only be used when APP_ENV=test");
  }
  testOverride = resolver;
}
