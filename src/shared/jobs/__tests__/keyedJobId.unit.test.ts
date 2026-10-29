import { describe, expect, it } from "vitest";
import { keyedJobId } from "../pgBoss";

describe("keyedJobId", () => {
  it("is a stable UUID for the same job name and key, and differs otherwise", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(keyedJobId("leads.timeout", "a")).toMatch(uuid);
    expect(keyedJobId("leads.timeout", "a")).toBe(keyedJobId("leads.timeout", "a"));
    expect(keyedJobId("leads.timeout", "a")).not.toBe(keyedJobId("leads.timeout", "b"));
    expect(keyedJobId("leads.timeout", "a")).not.toBe(keyedJobId("leads.reminder", "a"));
  });
});
