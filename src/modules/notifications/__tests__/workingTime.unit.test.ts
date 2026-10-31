// P8-SLA-06: SLA clocks count only working time, and stop on holidays.
import { describe, expect, it } from "vitest";
import { parseBusinessLocalDateTime as at } from "@/shared/time";
import {
  addWorkingMinutes,
  isWorkingDay,
  workingMinutesBetween,
} from "../notifications.workingTime";

// 2026-11-02 is a Monday; Monday to Saturday, 10:00 to 19:00.
const calendar = { days: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] as string[] };

describe("addWorkingMinutes", () => {
  it("counts plainly inside working hours", () => {
    expect(addWorkingMinutes(at("2026-11-02", "12:00"), 15, calendar)).toEqual(
      at("2026-11-02", "12:15"),
    );
  });
  it("starts at opening for an enquiry that came before it", () => {
    expect(addWorkingMinutes(at("2026-11-02", "08:00"), 15, calendar)).toEqual(
      at("2026-11-02", "10:15"),
    );
  });
  it("carries over to the next working day", () => {
    expect(addWorkingMinutes(at("2026-11-02", "18:50"), 15, calendar)).toEqual(
      at("2026-11-03", "10:05"),
    );
  });
  it("starts next morning for an enquiry that came at night", () => {
    expect(addWorkingMinutes(at("2026-11-02", "23:00"), 15, calendar)).toEqual(
      at("2026-11-03", "10:15"),
    );
  });
  it("skips a closed day", () => {
    expect(addWorkingMinutes(at("2026-11-07", "18:50"), 15, calendar)).toEqual(
      at("2026-11-09", "10:05"),
    );
  });
  it("skips a holiday", () => {
    const holiday = { ...calendar, holidays: ["2026-11-03"] };
    expect(addWorkingMinutes(at("2026-11-02", "23:00"), 15, holiday)).toEqual(
      at("2026-11-04", "10:15"),
    );
    expect(isWorkingDay("2026-11-03", holiday)).toBe(false);
  });
  it("falls exactly on closing time", () => {
    expect(addWorkingMinutes(at("2026-11-02", "18:45"), 15, calendar)).toEqual(
      at("2026-11-02", "19:00"),
    );
  });
  it("gives up rather than looping when there are no working days", () => {
    expect(addWorkingMinutes(at("2026-11-02", "12:00"), 15, { ...calendar, days: [] })).toBeNull();
  });
});

describe("workingMinutesBetween", () => {
  it("counts only working time, across nights and closed days", () => {
    expect(
      workingMinutesBetween(at("2026-11-02", "12:00"), at("2026-11-02", "12:15"), calendar),
    ).toBe(15);
    expect(
      workingMinutesBetween(at("2026-11-02", "22:00"), at("2026-11-03", "10:15"), calendar),
    ).toBe(15);
    expect(
      workingMinutesBetween(at("2026-11-07", "18:50"), at("2026-11-09", "10:05"), calendar),
    ).toBe(15);
  });
  it("is zero when the reply came first", () => {
    expect(
      workingMinutesBetween(at("2026-11-02", "12:15"), at("2026-11-02", "12:00"), calendar),
    ).toBe(0);
  });
});
