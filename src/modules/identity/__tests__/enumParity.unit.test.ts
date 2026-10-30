// Prisma enums are mirrored as `as const` arrays for UI code (database_schema.md Section 8).
import { describe, expect, it } from "vitest";
import { IdentityUserStatus } from "@/generated/prisma/enums";
import { IDENTITY_USER_STATUSES } from "../identity.types";

describe("enum parity", () => {
  it("IDENTITY_USER_STATUSES matches the Prisma enum", () => {
    expect([...IDENTITY_USER_STATUSES].sort()).toEqual(Object.values(IdentityUserStatus).sort());
  });
});
