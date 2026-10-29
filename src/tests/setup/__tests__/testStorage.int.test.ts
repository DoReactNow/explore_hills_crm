import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { resetTestStorage } from "../testStorage";

describe("resetTestStorage", () => {
  it("creates an empty test storage folder, removing files from earlier runs", () => {
    const dir = getEnv().STORAGE_LOCAL_DIR!;
    resetTestStorage();
    writeFileSync(join(dir, "left-over.txt"), "x");

    resetTestStorage();

    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });
});
