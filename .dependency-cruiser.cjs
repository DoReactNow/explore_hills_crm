// Architecture rules (npm run lint:arch). The rule numbers refer to
// CONTEXT/project_data.md Section 4.2. Rule 6 (repositories write only their own tables) is
// not an import rule; it is checked in review and by integration tests.

const TEST_FILES = "(\\.test\\.tsx?$|^src/tests/)";
const PRISMA =
  "(^src/generated/prisma/|node_modules/@prisma/(client|adapter-pg)/|node_modules/\\.prisma/)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "module-internals-from-module",
      comment: "Rule 1: a module imports another module only through its index.ts.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "module-internals-from-outside",
      comment:
        "Rule 1: code outside src/modules imports a module only through its index.ts (src/app may also import controllers, rule 2, and module UI, whose code the index must not pull into the browser).",
      severity: "error",
      from: { path: "^src/", pathNot: ["^src/modules/", TEST_FILES] },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: [
          "^src/modules/[^/]+/index\\.ts$",
          "^src/modules/[^/]+/[^/]+\\.controller\\.ts$",
          "^src/modules/[^/]+/ui/",
        ],
      },
    },
    {
      name: "controller-outside-app",
      comment: "Rule 2: only src/app/** imports a *.controller.ts.",
      severity: "error",
      from: { pathNot: ["^src/app/", TEST_FILES] },
      to: { path: "\\.controller\\.ts$" },
    },
    {
      name: "prisma-outside-repositories",
      comment: "Rule 3: only repositories, src/shared/db, seeds and scripts import Prisma.",
      severity: "error",
      from: {
        pathNot: [
          "\\.repository\\.ts$",
          "^src/shared/db/",
          "^src/generated/",
          "^prisma/",
          "^scripts/",
          TEST_FILES,
        ],
      },
      to: { path: PRISMA },
    },
    {
      name: "shared-imports-modules-or-worker",
      comment: "Rule 4: src/shared never imports src/modules or src/worker.",
      severity: "error",
      from: { path: "^src/shared/", pathNot: TEST_FILES },
      to: { path: "^src/(modules|worker)/" },
    },
    {
      name: "ui-imports-server-code",
      comment: "Rule 5: UI code never imports repositories, services, controllers or Prisma.",
      severity: "error",
      from: {
        path: ["^src/modules/[^/]+/ui/", "^src/app/.+\\.tsx$", "^src/shared/api/"],
        pathNot: TEST_FILES,
      },
      to: { path: ["\\.(repository|service|controller)\\.ts$", "^src/shared/db/", PRISMA] },
    },
    {
      name: "repository-imports-service",
      comment: "CSR layering: a repository never imports a service.",
      severity: "error",
      from: { path: "\\.repository\\.ts$" },
      to: { path: "\\.service\\.ts$" },
    },
    {
      name: "no-circular",
      comment: "Rule 7: no circular imports.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "telephony-provider-outside-registry",
      comment: "Rule 8: only the telephony registries import a provider folder.",
      severity: "error",
      from: { pathNot: ["^src/modules/telephony/providers/", "^src/modules/telephony/__tests__/"] },
      to: { path: "^src/modules/telephony/providers/[^/]+/" },
    },
    {
      name: "telephony-server-adapter-in-browser",
      comment: "Rule 8: server adapters never reach the browser bundle.",
      severity: "error",
      from: {
        path: [
          "^src/modules/telephony/providers/registry\\.browser\\.ts$",
          "/browser\\.ts$",
          "/ui/",
          "\\.tsx$",
        ],
      },
      to: {
        path: ["^src/modules/telephony/providers/[^/]+/server\\.ts$", "registry\\.server\\.ts$"],
      },
    },
    {
      name: "storage-driver-outside-registry",
      comment: "Rule 8: only src/shared/storage/registry.ts imports a storage driver.",
      severity: "error",
      from: {
        pathNot: [
          "^src/shared/storage/registry\\.ts$",
          "^src/shared/storage/drivers/",
          "^src/shared/storage/__tests__/",
        ],
      },
      to: { path: "^src/shared/storage/drivers/" },
    },
    {
      name: "pg-boss-outside-jobs",
      comment: "Rule 8: only src/shared/jobs/ imports pg-boss.",
      severity: "error",
      from: { pathNot: "^src/shared/jobs/" },
      to: { path: "(^|/)pg-boss($|/)" },
    },
  ],
  options: {
    // Generated Prisma code is a target of rule 3 but is not itself scanned.
    doNotFollow: { path: ["node_modules", "^src/generated/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
