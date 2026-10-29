// W-006: the date APIs that cause timezone bugs fail `lint:code` outside src/shared/time/.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleHits(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax" || m.ruleId === "no-restricted-properties")
    .map((m) => m.message);
}

const BANNED = [
  "export const a = new Date();",
  'export const b = new Date("2027-01-01 10:00");',
  "export const c = Date.now();",
  "export const d = (x: Date) => x.getHours();",
  "export const e = (x: Date) => x.getDate();",
  "export const f = (x: Date) => x.toLocaleDateString();",
  "export const g = (x: Date) => x.toLocaleTimeString();",
];

describe("date lint rules", () => {
  it.each(BANNED)(
    "rejects `%s` outside the time module",
    async (code) => {
      expect(await ruleHits(code, "src/modules/system/probe.ts")).not.toEqual([]);
    },
    30_000,
  );

  it("rejects them in test files too", async () => {
    expect(
      await ruleHits(BANNED[0], "src/modules/system/__tests__/probe.unit.test.ts"),
    ).not.toEqual([]);
  }, 30_000);

  it("allows them inside src/shared/time/", async () => {
    for (const code of BANNED) {
      expect(await ruleHits(code, "src/shared/time/probe.ts")).toEqual([]);
    }
  }, 30_000);

  it("still bans process.env outside env.ts alongside the date rules", async () => {
    expect(
      await ruleHits("export const x = process.env.FOO;", "src/modules/system/probe.ts"),
    ).not.toEqual([]);
  }, 30_000);
});
