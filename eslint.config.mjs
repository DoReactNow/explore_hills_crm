import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Environment values are read only through getEnv() (W-002, project_data.md Section 7).
const ENV_BAN = {
  object: "process",
  property: "env",
  message: "Read environment values through getEnv() from @/shared/config/env.",
};

// Date APIs that read the machine's timezone or the real clock (W-006, Decision 6).
const TIME_MESSAGE = "Use src/shared/time (Clock, parseInstant, toBusinessDate, formatInstant).";
const LOCAL_DATE_METHODS = [
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "getTimezoneOffset",
  "getYear",
  "setFullYear",
  "setMonth",
  "setDate",
  "setHours",
  "setMinutes",
  "setSeconds",
  "setMilliseconds",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
  "toDateString",
  "toTimeString",
];
const TIME_PROPERTY_BANS = [
  { object: "Date", property: "now", message: TIME_MESSAGE },
  { object: "Date", property: "parse", message: TIME_MESSAGE },
  ...LOCAL_DATE_METHODS.map((property) => ({ property, message: TIME_MESSAGE })),
];
const TIME_SYNTAX_BANS = [
  { selector: "NewExpression[callee.name='Date']", message: TIME_MESSAGE },
  { selector: "CallExpression[callee.name='Date']", message: TIME_MESSAGE },
];

const bans = ({ env, time }) => ({
  "no-restricted-properties": [
    "error",
    ...(env ? [ENV_BAN] : []),
    ...(time ? TIME_PROPERTY_BANS : []),
  ],
  "no-restricted-syntax": time ? ["error", ...TIME_SYNTAX_BANS] : "off",
});

const TEST_FILES = ["src/**/*.test.{ts,tsx}", "src/tests/**"];

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
  // Later blocks replace these rules for the files they match, so each block lists every ban
  // that applies to its files.
  { files: ["src/**/*.{ts,tsx}"], rules: bans({ env: true, time: true }) },
  { files: ["src/shared/config/env.ts", ...TEST_FILES], rules: bans({ env: false, time: true }) },
  { files: ["src/shared/time/**"], rules: bans({ env: true, time: false }) },
]);

export default eslintConfig;
