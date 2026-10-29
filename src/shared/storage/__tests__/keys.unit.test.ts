import { describe, expect, it } from "vitest";
import { assertStorageKey, buildKey } from "../keys";

const id = "0195f3c2-7a1b-7c3d-8e4f-123456789abc";

describe("buildKey()", () => {
  it("builds an area/year/month/id key from IDs and a business month", () => {
    expect(buildKey({ area: "recordings", yearMonth: "2026-12", id, extension: "mp3" })).toBe(
      `recordings/2026/12/${id}.mp3`,
    );
  });

  it("refuses anything that could carry personal data: the ID must be a UUID", () => {
    for (const bad of ["+919876543210", "riya@example.com", "Riya Kashmir trip", "../x"]) {
      expect(() => buildKey({ area: "recordings", yearMonth: "2026-12", id: bad, extension: "mp3" })).toThrow(/UUID/);
    }
  });

  it("refuses an unknown area, a malformed month or extension", () => {
    expect(() => buildKey({ area: "contacts" as never, yearMonth: "2026-12", id, extension: "mp3" })).toThrow(/area/);
    expect(() => buildKey({ area: "recordings", yearMonth: "2026-13", id, extension: "mp3" })).toThrow(/month/);
    expect(() => buildKey({ area: "recordings", yearMonth: "2026-12", id, extension: "m p3" })).toThrow(/extension/);
  });
});

describe("assertStorageKey()", () => {
  it("accepts keys made of safe segments", () => {
    expect(() => assertStorageKey(`recordings/2026/12/${id}.mp3`)).not.toThrow();
  });

  it.each(["", "/a", "a/../b", "..", "a\\b", "a//b", "a/./b", "a/.hidden", "a/b/", "x".repeat(600), "ä/b"])(
    "rejects %j",
    (bad) => {
      expect(() => assertStorageKey(bad)).toThrow(/storage key/i);
    },
  );
});
