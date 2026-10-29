import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Three projects (Decision 9): "unit" (logic, node), "unit-dom" (React components, jsdom)
// and "integration" (route handler to the real test database, run serially).
export default defineConfig({
  resolve: { alias: { "@": srcDir } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          include: ["src/**/*.unit.test.tsx"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          fileParallelism: false,
          globalSetup: ["src/tests/setup/integrationGlobalSetup.ts"],
          setupFiles: ["src/tests/setup/loadTestEnv.ts"],
        },
      },
    ],
  },
});
