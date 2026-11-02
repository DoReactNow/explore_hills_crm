import { describe, expect, it } from "vitest";
import { tripDates } from "../ui/shared";

describe("tripDates", () => {
  it("shortens a trip the way the design writes it", () => {
    expect(tripDates({ travelStartDate: "2026-12-10", travelEndDate: "2026-12-16" })).toBe(
      "10–16 Dec 2026",
    );
    expect(tripDates({ travelStartDate: "2026-11-29", travelEndDate: "2026-12-02" })).toBe(
      "29 Nov – 2 Dec 2026",
    );
    expect(tripDates({ travelStartDate: "2026-12-30", travelEndDate: "2027-01-02" })).toBe(
      "30 Dec 2026 – 2 Jan 2027",
    );
    expect(tripDates({ travelStartDate: "2026-12-10", travelEndDate: null })).toBe("10 Dec 2026");
    expect(tripDates({ travelStartDate: null, travelEndDate: null })).toBe("—");
  });
});
