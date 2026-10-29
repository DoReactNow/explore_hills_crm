import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// W-002 adds the unit project only. W-008 adds the integration project, jsdom and the setup files.
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
    ],
  },
});
