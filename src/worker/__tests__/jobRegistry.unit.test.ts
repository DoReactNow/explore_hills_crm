import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJob } from "@/shared/jobs/defineJob";
import { assembleJobs } from "../jobRegistry";

const make = (name: string) =>
  defineJob({
    name,
    payload: z.object({}),
    retry: { limit: 0, delaySeconds: 0, backoff: false },
    handler: async () => undefined,
  });

describe("job assembler", () => {
  it("collects every module's jobs by name", () => {
    const jobs = assembleJobs({ system: [make("system.a")], leads: [make("leads.b")] });
    expect([...jobs.keys()].sort()).toEqual(["leads.b", "system.a"]);
  });

  it("rejects duplicate job names (the module-name rule makes clashes between modules impossible)", () => {
    expect(() => assembleJobs({ system: [make("system.a"), make("system.a")] })).toThrow(
      /duplicate.*system\.a/i,
    );
  });

  it("rejects a job whose name does not start with its module", () => {
    expect(() => assembleJobs({ leads: [make("system.a")] })).toThrow(/leads/);
  });
});
