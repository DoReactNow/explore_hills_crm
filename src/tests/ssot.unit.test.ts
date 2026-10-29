// SSOT scan (Decision 7): email and phone literals, and the product and company names,
// may appear in src/ only inside appConfig.ts, tests and fixtures.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "@/shared/config/appConfig";

const SRC = join(process.cwd(), "src");

function isExempt(path: string): boolean {
  const rel = relative(SRC, path).split(sep).join("/");
  return (
    rel === "shared/config/appConfig.ts" ||
    rel.startsWith("generated/") ||
    rel.startsWith("tests/") ||
    rel.includes("/__tests__/") ||
    rel.includes("/fixtures/") ||
    /\.test\.tsx?$/.test(rel)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !isExempt(path) ? [path] : [];
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS: Array<[string, RegExp]> = [
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["E.164 phone number", /\+[1-9]\d{6,14}\b/],
  ["10-digit phone number", /(?<![\d.])\d{10}(?![\d.])/],
  ["product name", new RegExp(escape(APP_CONFIG.product.name), "i")],
  ["company name", new RegExp(escape(APP_CONFIG.company.legalName), "i")],
];

export function findSsotViolations(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [label, pattern] of PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1} contains a ${label}`);
        }
      }
    });
  }
  return violations;
}

describe("single source of truth scan", () => {
  it("finds no shared literals outside appConfig.ts, tests and fixtures", () => {
    expect(findSsotViolations(sourceFiles(SRC))).toEqual([]);
  });
});
