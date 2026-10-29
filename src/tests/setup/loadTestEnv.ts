// Loads .env.test (overriding anything already set) and runs the env guards, so an
// integration test can never reach the dev database. W-008 part A extends this setup.
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { getEnv } from "@/shared/config/env";

if (!existsSync(".env.test")) {
  throw new Error("Integration tests need .env.test: copy .env.test.example to .env.test");
}
config({ path: ".env.test", override: true, quiet: true });
getEnv();
