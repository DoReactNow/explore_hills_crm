// The committed test seed holds no passwords: credentials come from .env.test (Decision 11).
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const COMMITTED_SEED_FILES = [
  "prisma/seed-test.ts",
  "prisma/seeds/testSeed.ts",
  "prisma/seed.example.ts",
];

describe("committed seed files", () => {
  const exampleValues = Object.entries(parse(readFileSync(".env.test.example", "utf8")))
    .filter(([name]) => /PASSWORD/.test(name))
    .map(([, value]) => value);

  it.each(COMMITTED_SEED_FILES)("%s contains no password literal", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/password\s*[:=]\s*["'`][^"'`]+["'`]/i);
    for (const value of exampleValues) expect(source).not.toContain(value);
  });
});
