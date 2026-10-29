// The only API routes that may declare `access: 'public'` (project_data.md Section 5.2, rule 2).
// Adding a route here needs a decision-log entry. W-005 adds the scan that enforces this list.
export const PUBLIC_ROUTES = ["/api/health"] as const;
