// Defence in depth for high-risk actions (project_data.md Section 5.2, rule 5): services call this
// even though the route guard has already passed. The code goes to the log, never to the user.
import { AppError } from "@/shared/errors/AppError";
import { can } from "./guard";
import type { PermissionCode } from "./permissionRegistry";
import type { Principal } from "./principal";

export function assertCan(
  principal: Principal | null,
  code: PermissionCode,
): asserts principal is Principal {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  if (!can(principal, code)) {
    throw new AppError("FORBIDDEN", {
      logContext: { permission: code, principalId: principal.userId },
    });
  }
}
