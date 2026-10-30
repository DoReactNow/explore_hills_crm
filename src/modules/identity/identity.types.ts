// Types and constants of the identity module that UI code may import (no Prisma here).

/** Mirrors the Prisma enum IdentityUserStatus (parity is unit-tested). */
export const IDENTITY_USER_STATUSES = ["INVITED", "ACTIVE", "DEACTIVATED"] as const;
export type IdentityUserStatus = (typeof IDENTITY_USER_STATUSES)[number];
