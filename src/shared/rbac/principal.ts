// The "identity card" built on the server for every request (Decision 4).
import type { PermissionCode } from "./permissionRegistry";

export interface Principal {
  readonly userId: string;
  readonly roleCode: string;
  /** True only for SUPER_ADMIN. Read only by the guard and the scope resolver. */
  readonly bypassesAccess: boolean;
  readonly permissions: ReadonlySet<PermissionCode>;
}
