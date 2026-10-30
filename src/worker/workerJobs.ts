// The jobs this worker runs: every module's exported jobs, plus test-only jobs when APP_ENV=test.
import { assignmentJobs, assignmentSchedules } from "@/modules/assignment";
import { identityJobs, identitySchedules } from "@/modules/identity";
import { messagingJobs } from "@/modules/messaging";
import { systemJobs, systemTestJobs } from "@/modules/system";
import type { Env } from "@/shared/config/env";
import { assembleJobs } from "./jobRegistry";

export function collectWorkerJobs(appEnv: Env["APP_ENV"]) {
  return assembleJobs({
    assignment: assignmentJobs,
    identity: identityJobs,
    messaging: messagingJobs,
    system: [...systemJobs, ...(appEnv === "test" ? systemTestJobs : [])],
  });
}

export function collectWorkerSchedules() {
  return [...identitySchedules, ...assignmentSchedules];
}
