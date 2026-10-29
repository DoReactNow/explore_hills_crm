// Next.js calls register() once when a server starts: the composition root for request identity.
// Phase 0 installs only the test-only role cookie, and only when APP_ENV=test.
// Phase 1 installs the session-based principal resolver here.
export async function register(): Promise<void> {
  // NEXT_RUNTIME is set by Next.js itself and is not part of the app's environment schema.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/shared/config/env");
  let appEnv: string;
  try {
    appEnv = getEnv().APP_ENV;
  } catch {
    return; // no runtime environment (for example during `next build`): nothing to install
  }
  if (appEnv !== "test") return;

  const { buildPrincipalForRole } = await import("@/modules/identity");
  const { installTestRoleCookieResolver } = await import("@/shared/rbac/testRoleCookie");
  installTestRoleCookieResolver(buildPrincipalForRole);
}
