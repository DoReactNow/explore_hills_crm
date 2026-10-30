// Next.js calls register() once when a server starts: the composition root for request identity
// and the startup checks. Every environment gets the session-based principal resolver; when
// APP_ENV=test, the test-only role cookie is layered on top of it.
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

  // Fail at startup, not on the first upload, when the storage driver is wrong.
  const { getFileStorage } = await import("@/shared/storage");
  getFileStorage();

  const { buildPrincipalForRole, createSessionPrincipalResolver } =
    await import("@/modules/identity");
  const sessionResolver = createSessionPrincipalResolver();
  if (appEnv !== "test") {
    const { configurePrincipalResolver } = await import("@/shared/rbac/principalResolver");
    configurePrincipalResolver(sessionResolver);
    return;
  }
  const { installTestRoleCookieResolver } = await import("@/shared/rbac/testRoleCookie");
  installTestRoleCookieResolver(buildPrincipalForRole, sessionResolver);
}
