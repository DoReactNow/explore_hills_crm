// The only API routes that may declare `access: 'public'` (project_data.md Section 5.2, rule 2).
// Adding a route here needs a decision-log entry. src/tests/scans/routeGuards.unit.test.ts
// enforces this list.
export const PUBLIC_ROUTES = [
  "/api/health",
  "/api/auth/sign-in",
  // Public so that repeating it, or an expired session, succeeds quietly (Decision 52).
  "/api/auth/sign-out",
  // Test-only: answers 404 unless APP_ENV=test (Decision 36).
  "/api/test-support/fail",
] as const;
