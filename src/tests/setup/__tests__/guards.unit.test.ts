import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl, assertTestStorageDir } from "../guards";

describe("test safety guards", () => {
  it("accepts only database URLs whose database name ends in _test", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:54329/explorehills_test"),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:54329/explorehills_dev"),
    ).toThrow(/refusing to run/i);
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@127.0.0.1:54329/explorehills_test_copy"),
    ).toThrow(/refusing to run/i);
  });

  it("accepts only a storage folder named test inside storage/", () => {
    expect(() => assertTestStorageDir("./storage/test")).not.toThrow();
    expect(() => assertTestStorageDir("./storage")).toThrow(/refusing to run/i);
    expect(() => assertTestStorageDir("/tmp/test")).toThrow(/refusing to run/i);
    expect(() => assertTestStorageDir("./storage/test/../../src")).toThrow(/refusing to run/i);
  });
});
