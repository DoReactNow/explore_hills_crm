// WhatsApp messages are processed and sent by the worker, so E2E runs one against the test database.
import { spawn } from "node:child_process";

export default async function startWorker(): Promise<() => Promise<void>> {
  const worker = spawn(
    "npx",
    ["dotenv", "run", "-q", "--override", "-f", ".env.test", "--", "tsx", "src/worker/index.ts"],
    {
      stdio: "ignore",
      detached: true,
    },
  );
  return async () => {
    if (worker.pid) process.kill(-worker.pid, "SIGTERM");
  };
}
