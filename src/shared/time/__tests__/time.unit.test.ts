// Runs under TZ=UTC, Asia/Kolkata, America/Los_Angeles and Pacific/Kiritimati (test:unit:tz):
// every expectation here must hold whatever the machine's timezone is.
import { describe, expect, it } from "vitest";
import {
  businessDateToDbDate,
  businessDayRange,
  createTestClock,
  dbDateToBusinessDate,
  formatBusinessDate,
  formatInstant,
  isBusinessDate,
  parseBusinessLocalDateTime,
  parseInstant,
  toBusinessDate,
  toIsoInstant,
  todayBusinessDate,
} from "..";

const iso = (value: Date) => toIsoInstant(value);
const HOUR = 60 * 60 * 1000;

describe("toBusinessDate (Asia/Kolkata)", () => {
  it("puts 2026-12-31T18:35:00Z on 1 January 2027", () => {
    expect(toBusinessDate(parseInstant("2026-12-31T18:35:00Z"))).toBe("2027-01-01");
  });

  it("keeps 2026-12-31T18:29:59Z on 31 December 2026", () => {
    expect(toBusinessDate(parseInstant("2026-12-31T18:29:59Z"))).toBe("2026-12-31");
  });

  it("puts local midnight exactly on the new day", () => {
    expect(toBusinessDate(parseInstant("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
});

describe("businessDayRange", () => {
  it("returns the half-open UTC range of a business day", () => {
    const { start, end } = businessDayRange("2027-01-01");
    expect(iso(start)).toBe("2026-12-31T18:30:00.000Z");
    expect(iso(end)).toBe("2027-01-01T18:30:00.000Z");
  });

  it("leaves no gap and no overlap between adjacent days", () => {
    const days = ["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"];
    for (let i = 0; i < days.length - 1; i++) {
      expect(businessDayRange(days[i]).end.getTime()).toBe(
        businessDayRange(days[i + 1]).start.getTime(),
      );
    }
  });

  it("produces 23- and 25-hour days in a DST zone", () => {
    const zone = "America/New_York";
    const spring = businessDayRange("2027-03-14", { zone });
    const autumn = businessDayRange("2027-11-07", { zone });
    const normal = businessDayRange("2027-03-15", { zone });
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * HOUR);
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * HOUR);
    expect(normal.end.getTime() - normal.start.getTime()).toBe(24 * HOUR);
  });

  it("rejects something that is not a YYYY-MM-DD calendar day", () => {
    for (const bad of ["2027-02-30", "2027-1-01", "01/01/2027", "2027-01-01T00:00"]) {
      expect(() => businessDayRange(bad)).toThrow(/business date/i);
      expect(isBusinessDate(bad)).toBe(false);
    }
    expect(isBusinessDate("2028-02-29")).toBe(true);
  });
});

describe("parseBusinessLocalDateTime", () => {
  it("turns 1 January 2027 00:05 in Kolkata into the right UTC instant", () => {
    expect(iso(parseBusinessLocalDateTime("2027-01-01", "00:05"))).toBe("2026-12-31T18:35:00.000Z");
  });

  it("round-trips with toBusinessDate at 23:59 and 00:01", () => {
    expect(toBusinessDate(parseBusinessLocalDateTime("2027-01-31", "23:59"))).toBe("2027-01-31");
    expect(toBusinessDate(parseBusinessLocalDateTime("2027-02-01", "00:01"))).toBe("2027-02-01");
  });

  it("rejects an invalid time of day", () => {
    expect(() => parseBusinessLocalDateTime("2027-01-01", "24:00")).toThrow();
    expect(() => parseBusinessLocalDateTime("2027-01-01", "9:5")).toThrow();
  });
});

describe("formatting", () => {
  it("formats an instant in the business timezone, whatever the machine TZ is", () => {
    const instant = parseInstant("2026-12-31T18:35:00Z");
    expect(formatInstant(instant, "date")).toBe("1 Jan 2027");
    expect(formatInstant(instant, "time")).toBe("12:05 am");
    expect(formatInstant(instant, "dateTime")).toBe("1 Jan 2027, 12:05 am");
  });

  it("formats a business date without converting it through a timezone", () => {
    expect(formatBusinessDate("2027-01-01", "date")).toBe("1 Jan 2027");
    expect(formatBusinessDate("2027-01-01", "longDate")).toBe("Friday, 1 January 2027");
  });
});

describe("business date and the database @db.Date value", () => {
  it("round-trips YYYY-MM-DD through the Prisma Date value without shifting a day", () => {
    for (const day of ["2026-12-31", "2027-01-01", "2027-03-14", "2028-02-29"]) {
      const dbValue = businessDateToDbDate(day);
      expect(iso(dbValue)).toBe(`${day}T00:00:00.000Z`); // what Prisma sends and returns for @db.Date
      expect(dbDateToBusinessDate(dbValue)).toBe(day);
    }
  });
});

describe("test clock", () => {
  it("can be frozen, advanced and set, and drives todayBusinessDate", () => {
    const clock = createTestClock("2027-01-31T18:29:00Z"); // 23:59 in Kolkata
    expect(todayBusinessDate(clock)).toBe("2027-01-31");
    expect(iso(clock.now())).toBe(iso(clock.now()));

    clock.advance({ minutes: 2 }); // 00:01 next day
    expect(todayBusinessDate(clock)).toBe("2027-02-01");

    clock.set("2027-06-01T00:00:00Z");
    expect(iso(clock.now())).toBe("2027-06-01T00:00:00.000Z");
  });

  it("returns a copy, so callers cannot move the frozen time by mutating it", () => {
    const clock = createTestClock("2027-01-01T00:00:00Z");
    clock.now().setTime(0);
    expect(iso(clock.now())).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("instants", () => {
  it("parses only ISO-8601 instants that carry a zone", () => {
    expect(iso(parseInstant("2027-01-01T05:30:00+05:30"))).toBe("2027-01-01T00:00:00.000Z");
    expect(() => parseInstant("2027-01-01T10:00:00")).toThrow(/instant/i);
    expect(() => parseInstant("yesterday")).toThrow(/instant/i);
  });
});
