// The jobs this worker runs: every module's exported jobs, plus test-only jobs when APP_ENV=test.
import { identityJobs, identitySchedules } from "@/modules/identity";
import { systemJobs, systemTestJobs } from "@/modules/system";
import type { Env } from "@/shared/config/env";
import { assembleJobs } from "./jobRegistry";

export function collectWorkerJobs(appEnv: Env["APP_ENV"]) {
  return assembleJobs({
    identity: identityJobs,
    system: [...systemJobs, ...(appEnv === "test" ? systemTestJobs : [])],
  });
}

export function collectWorkerSchedules() {
  return [...identitySchedules];
}
