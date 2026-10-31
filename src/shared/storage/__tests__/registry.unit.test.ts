import { describe, expect, it } from "vitest";
import { createFileStorage } from "../registry";

describe("storage driver registry", () => {
  it("returns the driver named by STORAGE_DRIVER", () => {
    expect(createFileStorage({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "./storage/test" }).driver).toBe("local");
  });

  it("builds the s3 driver from its settings", () => {
    const storage = createFileStorage({
      STORAGE_DRIVER: "s3",
      STORAGE_S3_ENDPOINT: "http://127.0.0.1:9000",
      STORAGE_S3_REGION: "us-east-1",
      STORAGE_S3_BUCKET: "b",
      STORAGE_S3_ACCESS_KEY_ID: "k",
      STORAGE_S3_SECRET_ACCESS_KEY: "s",
    });
    expect(storage.driver).toBe("s3");
  });

  it("fails clearly for an unknown driver or a missing local folder", () => {
    expect(() => createFileStorage({ STORAGE_DRIVER: "floppy" as never })).toThrow(/Unknown STORAGE_DRIVER "floppy"/);
    expect(() => createFileStorage({ STORAGE_DRIVER: "local" })).toThrow(/STORAGE_LOCAL_DIR/);
  });
});
