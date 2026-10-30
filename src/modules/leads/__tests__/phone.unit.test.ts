import { describe, expect, it } from "vitest";
import { normalisePhone } from "../leads.phone";

describe("normalisePhone (P3-LEAD-03, -04, -05)", () => {
  it.each([
    ["9000000001", "+919000000001"],
    ["+91 90000 00001", "+919000000001"],
    ["090000-00001", "+919000000001"],
    ["91 90000 00001", "+919000000001"],
    ["(+91) 90000-00001", "+919000000001"],
  ])("normalises the Indian number %s", (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each([
    ["+1 415 555 2671", "+14155552671"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+971 50 123 4567", "+971501234567"],
  ])("keeps the foreign number %s", (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(["", "12345", "90000 0001", "900000000012345678", "call me", "98765abcde", "+"])(
    "refuses %j",
    (raw) => {
      expect(normalisePhone(raw)).toBeNull();
    },
  );
});
