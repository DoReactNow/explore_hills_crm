import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output (see .gitignore):
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
  ]),
  {
    // Environment values are read only through getEnv() (W-002, project_data.md Section 7).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/shared/config/env.ts", "**/*.test.{ts,tsx}", "src/tests/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read environment values through getEnv() from @/shared/config/env.",
        },
      ],
    },
  },
]);

export default eslintConfig;
