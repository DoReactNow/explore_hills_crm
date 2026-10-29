// Guard coverage (Decision 4): every API route uses route() and declares its access, and every
// public route is in the allow-list.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES } from "@/shared/rbac/publicRoutes";

const API_DIR = join(process.cwd(), "src", "app", "api");
const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js)$/.test(name) ? [path] : [];
  });
}

/** src/app/api/health/route.ts → /api/health ; route groups "(x)" are dropped. */
function urlPathOf(file: string): string {
  const segments = relative(join(process.cwd(), "src", "app"), file)
    .split(sep)
    .slice(0, -1);
  return "/" + segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/");
}

export function findGuardProblems(files: string[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const name = relative(process.cwd(), file);
    const exported = [
      ...source.matchAll(
        new RegExp(`export\\s+(?:async\\s+)?(?:const|function|let)\\s+(${METHODS})\\b([^;]*)`, "g"),
      ),
    ];
    const reExports = new RegExp(`export\\s*\\{[^}]*\\b(${METHODS})\\b`).test(source);
    if (reExports)
      problems.push(`${name}: re-exports a handler; declare it with route() in this file`);
    if (exported.length === 0 && !reExports) problems.push(`${name}: exports no handler`);
    for (const [, method, rest] of exported) {
      if (!/^\s*=\s*route\(\{/.test(rest)) problems.push(`${name}: ${method} does not use route()`);
    }
    const accesses = [
      ...source.matchAll(/access:\s*("public"|'public'|"authenticated"|'authenticated'|\{)/g),
    ];
    if (accesses.length < exported.length)
      problems.push(`${name}: a handler does not declare access`);
    if (
      /access:\s*["']public["']/.test(source) &&
      !(PUBLIC_ROUTES as readonly string[]).includes(urlPathOf(file))
    ) {
      problems.push(`${name}: public route ${urlPathOf(file)} is not in publicRoutes.ts`);
    }
  }
  return problems;
}

describe("API route guard coverage", () => {
  it("finds route files to check", () => {
    expect(routeFiles(API_DIR).length).toBeGreaterThan(0);
  });

  it("every route uses route() with an access declaration; public routes are allow-listed", () => {
    expect(findGuardProblems(routeFiles(API_DIR))).toEqual([]);
  });

  it("every allow-listed public route exists", () => {
    const existing = routeFiles(API_DIR).map(urlPathOf);
    for (const path of PUBLIC_ROUTES) expect(existing, path).toContain(path);
  });
});
