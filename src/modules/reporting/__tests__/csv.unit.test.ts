// P9-EXPORT-04, -05: spreadsheet-safe values.
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvRow } from "../reporting.csv";

describe("csvCell", () => {
  it.each(["=SUM(A1)", "+91 98000", "-5", "@cmd", "\tx", "\rx"])(
    "stops %j running as a formula",
    (value) => {
      expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );
  it("leaves numbers alone, so they stay numbers", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(12)).toBe("12");
  });
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("keeps Hindi and emoji, and marks the file for Excel", () => {
    expect(csvCell("सुनीता 🌴")).toBe("सुनीता 🌴");
    expect(CSV_BOM).toBe("﻿");
  });
  it("makes nothing out of nothing", () => {
    expect(csvRow([null, undefined, "x"])).toBe(",,x\r\n");
  });
});
