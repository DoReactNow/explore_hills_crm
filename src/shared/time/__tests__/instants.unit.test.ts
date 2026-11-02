import { describe, expect, it } from "vitest";
import { parseCertificateDate } from "../instants";
describe("parseCertificateDate", () => {
  it("reads the format certificates use, as UTC", () => {
    expect(parseCertificateDate("Jan  2 15:04:05 2027 GMT").toISOString()).toBe(
      "2027-01-02T15:04:05.000Z",
    );
  });
  it("refuses anything else", () => {
    expect(() => parseCertificateDate("soon")).toThrow(RangeError);
  });
});
