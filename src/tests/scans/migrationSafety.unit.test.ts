// P12-DEPLOY-02: a migration must work with the previous app version, so a rollback is safe. Anything
// that removes or renames needs the marker, after the code that used it has already gone (Decision 69).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CHECKED_FROM = "20261101";
const RISKY =
  /\b(DROP\s+(TABLE|COLUMN)|RENAME\s+(TO|COLUMN)|ALTER\s+COLUMN\s+\S+\s+(TYPE|SET\s+NOT\s+NULL))\b/i;
const MARKER = "-- rollback-safe: previous release no longer uses this";

function unsafe(sql: string): boolean {
  return RISKY.test(sql) && !sql.includes(MARKER);
}

describe("migrations", () => {
  it("spots what would break the previous version", () => {
    expect(unsafe('ALTER TABLE "x" DROP COLUMN "y";')).toBe(true);
    expect(unsafe('ALTER TABLE "x" RENAME COLUMN "y" TO "z";')).toBe(true);
    expect(unsafe('ALTER TABLE "x" ALTER COLUMN "y" SET NOT NULL;')).toBe(true);
    expect(unsafe('ALTER TABLE "x" ADD COLUMN "y" TEXT;')).toBe(false);
    expect(unsafe(`${MARKER}\nDROP TABLE "x";`)).toBe(false);
  });

  it("from now on, none does so unmarked", () => {
    const bad = readdirSync("prisma/migrations")
      .filter((name) => name >= CHECKED_FROM && !name.endsWith(".toml"))
      .filter((name) => unsafe(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")));
    expect(bad).toEqual([]);
  });
});
