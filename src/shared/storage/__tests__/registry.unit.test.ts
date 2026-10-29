import { describe, expect, it } from "vitest";
import { createFileStorage } from "../registry";

describe("storage driver registry", () => {
  it("returns the driver named by STORAGE_DRIVER", () => {
    expect(createFileStorage({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "./storage/test" }).driver).toBe("local");
  });

  it("explains that the s3 driver arrives in Phase 7", () => {
    expect(() => createFileStorage({ STORAGE_DRIVER: "s3" })).toThrow(/s3.*Phase 7/);
  });

  it("fails clearly for an unknown driver or a missing local folder", () => {
    expect(() => createFileStorage({ STORAGE_DRIVER: "floppy" as never })).toThrow(/Unknown STORAGE_DRIVER "floppy"/);
    expect(() => createFileStorage({ STORAGE_DRIVER: "local" })).toThrow(/STORAGE_LOCAL_DIR/);
  });
});
