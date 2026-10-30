import { describe, expect, it } from "vitest";
import { safeNextPath } from "../ui/safeNextPath";

describe("safeNextPath (P1-SIGNIN-11)", () => {
  it.each([
    ["/diagnostics", "/diagnostics"],
    ["/leads?stage=new&page=2", "/leads?stage=new&page=2"],
    ["/leads#notes", "/leads#notes"],
  ])("keeps the same-site path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/\t/evil.example",
    "",
    null,
    undefined,
    "/sign-in",
    "/sign-in?next=/x",
  ])("goes home for %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
});
