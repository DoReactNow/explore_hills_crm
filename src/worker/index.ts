// Placeholder worker (W-001). W-012 replaces it with the pg-boss worker.
// It only proves the build, script and container wiring: start, log, wait for SIGTERM.

const keepAlive = setInterval(() => {}, 60_000);

function shutdown(signal: string): void {
  console.log(`[worker] received ${signal}, shutting down`);
  clearInterval(keepAlive);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[worker] placeholder started; waiting for SIGTERM");
