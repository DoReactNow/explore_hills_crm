// Runs once before the integration project: fails fast when .env.test is missing or points
// at a non-test database, and starts the run with an empty test storage folder.
import { loadTestEnv } from "./testEnv";
import { resetTestStorage } from "./testStorage";

export default function setup(): void {
  try {
    const env = loadTestEnv();
    resetTestStorage();
    console.log(`[tests] loaded .env.test (database "${env.databaseName}")`);
  } catch (error) {
    // Print the reason ourselves: Vitest 5 can mask errors thrown from global setup
    // behind an unrelated source-map error.
    console.error(`\n[tests] ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}
