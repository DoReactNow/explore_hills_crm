// Spreadsheet-safe CSV. The byte-order mark makes Excel read Hindi and emoji correctly, and a value that
// a spreadsheet would run as a formula is made plain text (P9-EXPORT-04, -05).
export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const csvRow = (cells: ReadonlyArray<string | number | null | undefined>) =>
  `${cells.map(csvCell).join(",")}\r\n`;
