// Assembles every module's jobs for the worker (the composition root, Decision 27).
// Job names are unique across modules and start with their module's name.
import type { AnyJobDefinition } from "@/shared/jobs";

export function assembleJobs(
  modules: Record<string, ReadonlyArray<AnyJobDefinition>>,
): Map<string, AnyJobDefinition> {
  const jobs = new Map<string, AnyJobDefinition>();
  for (const [module, list] of Object.entries(modules)) {
    for (const job of list) {
      if (!job.name.startsWith(`${module}.`)) {
        throw new Error(
          `Job ${job.name} is exported by the ${module} module but is not named ${module}.<job>`,
        );
      }
      if (jobs.has(job.name)) throw new Error(`Duplicate job name: ${job.name}`);
      jobs.set(job.name, job);
    }
  }
  return jobs;
}
