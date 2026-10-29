import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Unit project since W-002; minimal integration project since W-007. W-008 adds jsdom,
// the global safety setup and the shared test helpers.
export default defineConfig({
  resolve: { alias: { "@": srcDir } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          fileParallelism: false,
          setupFiles: ["src/tests/setup/loadTestEnv.ts"],
        },
      },
    ],
  },
});
