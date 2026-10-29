// Starts `next dev` or `next start` on the host and port from the chosen env file.
// Usage: node scripts/run-next.mjs <dev|start> <env file>
// Values already set in the process environment win, so containers work without an env file.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import dotenv from "dotenv";

const [mode, envFile] = process.argv.slice(2);

function fail(message) {
  console.error(`[run-next] ${message}`);
  process.exit(1);
}

if (mode !== "dev" && mode !== "start") {
  fail('first argument must be "dev" or "start"');
}
if (!envFile) {
  fail("second argument must be the env file path, for example .env");
}

const envPath = resolve(envFile);
const envFileFound = existsSync(envPath);
if (envFileFound) {
  // override: false keeps values that are already set in the environment.
  dotenv.config({ path: envPath, override: false, quiet: true });
}

const missing = ["APP_HOST", "APP_PORT"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  const hint = envFileFound
    ? `add them to ${envFile}`
    : `${envFile} was not found; copy the matching *.example file (see CONTEXT/local_setup.md Section 2)`;
  fail(`missing ${missing.join(" and ")}: ${hint}`);
}

const host = process.env.APP_HOST;
const port = process.env.APP_PORT;
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  fail(`APP_PORT must be a port number between 1 and 65535 (got "${port}")`);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, mode, "-H", host, "-p", port], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
