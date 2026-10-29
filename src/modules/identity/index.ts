// Public API of the identity module: the only entry point for other modules.
import { identityService } from "./identity.service";

export { syncRbac, type SyncRbacOptions, type SyncRbacSummary } from "./rbac/syncRbac";

export const buildPrincipalForRole = identityService.buildPrincipalForRole;
