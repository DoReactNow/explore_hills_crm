import { describe, expect, it } from "vitest";
import { findForbiddenFiles } from "../../../scripts/check-forbidden-files.mjs";

describe("forbidden files guard", () => {
  it("allows normal files and the three env examples", () => {
    expect(
      findForbiddenFiles([
        ".env.example",
        ".env.test.example",
        ".env.production.example",
        "prisma/seed.example.ts",
        "src/app/page.tsx",
      ]),
    ).toEqual([]);
  });

  it("flags anything under prisma/private/ and every real env file", () => {
    expect(
      findForbiddenFiles([
        "prisma/private/seed.ts",
        ".env",
        ".env.test",
        ".env.production",
        ".env.local",
        "docker/.env",
        "storage/test/recording.mp3",
      ]),
    ).toEqual([
      "prisma/private/seed.ts",
      ".env",
      ".env.test",
      ".env.production",
      ".env.local",
      "docker/.env",
      "storage/test/recording.mp3",
    ]);
  });
});
