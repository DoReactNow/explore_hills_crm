// Public API of the identity module: the only entry point for other modules.
import { identityService } from "./identity.service";

export { syncRbac, type SyncRbacOptions, type SyncRbacSummary } from "./rbac/syncRbac";
export {
  assertPasswordStrength,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "./identity.passwords";

export { createUserIfMissing, ensureFirstSuperAdmin } from "./identity.operator";
export { createSessionPrincipalResolver } from "./identity.session";

export const buildPrincipalForRole = identityService.buildPrincipalForRole;
