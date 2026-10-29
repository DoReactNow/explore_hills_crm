// E2E runs a real browser against the BUILT app (`npm run build` first), served with
// .env.test on APP_PORT (47215). Only the critical journeys in Decision 29 live in e2e/.
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test", override: true, quiet: true });

const baseURL = process.env.APP_URL;
if (!baseURL || !process.env.APP_PORT) {
  throw new Error(
    "E2E needs .env.test with APP_URL and APP_PORT: copy .env.test.example to .env.test",
  );
}
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `next start` on the existing build; with output: "standalone" Next prints a warning
    // but serves normally (choice recorded in current_state.md, W-008).
    command: "npm run start:test",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
