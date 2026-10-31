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
export { identityJobs, identitySchedules } from "./identity.jobs";
export { createSessionPrincipalResolver } from "./identity.session";

export {
  getUserSummary,
  getVisibleAgentIds,
  listAssignableUsers,
  listCallers,
} from "./identity.scope";
export { userService } from "./identity.users.service";
export { toUserView } from "./identity.users.repository";
export type { UserContext } from "./identity.context";

export const buildPrincipalForRole = identityService.buildPrincipalForRole;
