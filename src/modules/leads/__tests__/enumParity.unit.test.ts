import { describe, expect, it } from "vitest";
import { LeadsSource, LeadsStageKind } from "@/generated/prisma/enums";
import { LEAD_SOURCES, STAGE_KINDS } from "../leads.types";

describe("enum parity", () => {
  it("matches Prisma", () => {
    expect([...LEAD_SOURCES].sort()).toEqual(Object.values(LeadsSource).sort());
    expect([...STAGE_KINDS].sort()).toEqual(Object.values(LeadsStageKind).sort());
  });
});
