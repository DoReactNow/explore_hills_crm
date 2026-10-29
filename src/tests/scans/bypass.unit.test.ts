// Only the guard and the scope resolver decide on the Super Admin bypass, and feature code never
// compares role codes (Decision 23). The identity module owns the role data, so it may read it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ALLOWED = [
  /^shared\/rbac\/(guard|scope|principal|defaultRoles)\.ts$/,
  /^modules\/identity\//,
  /^generated\//,
  /^tests\//,
  /\/__tests__\//,
  /\.test\.tsx?$/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const ROLE = `["'](SUPER_ADMIN|ADMIN|MANAGER|AGENT)["']`;
const PATTERNS: Array<[string, RegExp]> = [
  ["reads bypassesAccess", /bypassesAccess/],
  [
    "compares a role code",
    new RegExp(`(===|!==|==|!=)\\s*${ROLE}|${ROLE}\\s*(===|!==|==|!=)|case\\s+${ROLE}`),
  ],
  ["compares roleCode", /roleCode\s*(===|!==|==|!=)|(===|!==|==|!=)\s*\w*\.?roleCode\b/],
];

describe("Super Admin bypass and role-name scan", () => {
  it("finds no bypass reads or role-code comparisons outside the allowed files", () => {
    const problems: string[] = [];
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (ALLOWED.some((pattern) => pattern.test(rel))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const [label, pattern] of PATTERNS) {
            if (pattern.test(line)) problems.push(`src/${rel}:${index + 1} ${label}`);
          }
        });
    }
    expect(problems).toEqual([]);
  });
});
