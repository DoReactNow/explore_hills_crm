// P11-SEC-07: run after `npm run build`. Starts the built app as production and proves that test-only
// routes, cookies and pages can't be reached. Nothing here needs the database to answer, so the address
// it is given holds no data; real providers are named but never called.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const PORT = 47219;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_HOST: "127.0.0.1",
    APP_PORT: String(PORT),
    APP_URL: "https://crm.example.test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://nobody:nobody@127.0.0.1:1/explorehills_surface",
    AUTH_SECRET: randomBytes(32).toString("hex"),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TELEPHONY_PROVIDER: "none",
    WHATSAPP_GATEWAY: "none",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "storage/surface-check",
    EMAIL_DRIVER: "smtp",
    EMAIL_FROM: "surface@example.com",
    SMTP_URL: "smtp://127.0.0.1:1",
    PUSH_DRIVER: "webpush",
    VAPID_PUBLIC_KEY: "surface-check-public",
    VAPID_PRIVATE_KEY: "surface-check-private",
  },
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

async function waitUntilUp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/sign-in`);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw new Error(`the production build did not start:\n${output}`);
}

const TEST_COOKIE = { cookie: "eh_test_role=SUPER_ADMIN" };
const CHECKS = [
  ["test failure route", "/api/test-support/fail", {}, 404],
  ["test failure route with the role cookie", "/api/test-support/fail", TEST_COOKIE, 404],
  ["test error page", "/test-support/server-error", {}, 404],
  ["role cookie gives no identity", "/api/auth/me", TEST_COOKIE, 401],
  ["role cookie opens no people list", "/api/users", TEST_COOKIE, 401],
  ["role cookie opens no diagnostics", "/api/diagnostics", TEST_COOKIE, 401],
  ["signed-out people list", "/api/users", {}, 401],
];

let failed = false;
try {
  await waitUntilUp();
  for (const [name, path, headers, expected] of CHECKS) {
    const response = await fetch(`${BASE}${path}`, { headers });
    await response.text();
    const good = response.status === expected;
    if (!good) failed = true;
    console.log(`${good ? "ok  " : "FAIL"} ${name}: ${path} answered ${response.status}`);
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  child.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
