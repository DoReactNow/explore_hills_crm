# Current State: Explore Hills CRM Implementation Tracker

This is the source of truth for what is done and what is next. **Check this file first in every session.** Update it as items are completed.

> **Plan updated 2026-10-29** to match `decision_log.md` Decisions 21–31: single company, cross-module foreign keys, Super Admin and the Roles & Permissions page, browser calling through provider adapters, recordings in swappable file storage, background jobs (pg-boss + worker) and live updates (SSE). Phase 0 gained W-012 to W-014; the fresh-clone drill is now W-015.

**Legend:** `[ ]` pending · `[x]` done · **PENDING** phase not started · **IN PROGRESS** · **DONE**

**How phases work**

- Phase 0 is fully planned below and ready to execute.
- Phases 1 to 13 are high-level only. Before starting any of them, investigate the existing code, then write its detailed work items **using `TDD_INSTRUCTION_GUIDE.md`** (Part 2 template, Part 3 rules), place them under that phase in this file, show the plan to the user, and **wait for approval before coding**.
- Do not start a phase until every box in the previous phase is ticked.

---

## Progress Summary

| Phase | Title | Status |
|:---|:---|:---|
| 0 | Foundation: structure, tooling, tests, CI/CD, Docker, conventions, background jobs, live updates, file storage | **IN PROGRESS** (W-001, W-002, W-010 part A, W-007, W-008 part A, W-003, W-004, W-006, W-005, W-008 part B done) |
| 1 | Identity: users, sessions, real RBAC end to end | PENDING |
| 2 | Teams, hierarchy and the Roles & Permissions page | PENDING |
| 3 | Lead core and agent-facing lead screens | PENDING |
| 4 | WhatsApp integration (inbox, leads from messages) | PENDING |
| 5 | Manager queue and assignment engine | PENDING |
| 6 | Agent workspace | PENDING |
| 7 | Browser calling (telephony adapters), call logging and recordings | PENDING |
| 8 | Notifications and SLA automation | PENDING |
| 9 | Reports and dashboards | PENDING |
| 10 | Audit, data protection and retention | PENDING |
| 11 | Hardening, observability and performance | PENDING |
| 12 | Production deployment and runbook | PENDING |
| 13 | Future: WhatsApp calling inside the platform | DEFERRED |

---

# Phase 0: Foundation — IN PROGRESS

**Goal:** A repository where a new developer can clone, copy two env files, start Docker, and run the entire quality suite green, with the architecture, RBAC mechanics (including the Super Admin bypass), error handling, date handling, background jobs, live updates, file storage and pipelines already in place. No product features yet.

**Read before starting:** `project_data.md` (Sections 4 to 10), `decision_log.md` (Decisions 1 to 16 and 21 to 29; Decision 3 is superseded by 22), `database_schema.md` (Sections 1, 3.1, 3.6, 6), `local_setup.md`, `TDD_INSTRUCTION_GUIDE.md`.

**Execution order for Phase 0** (the item numbers are labels, not the order; this order avoids circular dependencies):
`W-001 → W-002 → W-010 part A (local Postgres container only) → W-007 → W-008 part A → W-003 → W-004 → W-006 → W-005 → W-008 part B → W-009 → W-010 part B (app and worker containers, production images) → W-011 → W-012 → W-013 → W-014 → W-015`.
Phase 0 has **no user accounts** (`identity_users` arrives in Phase 1). Everything that needs a signed-in user uses the test principal (W-005/W-008) in tests.

**Definition of done for Phase 0:** `npm run ci:quality` passes on a fresh clone; the GitHub pipeline is green with separate steps; the fresh-clone drill in W-015 passes; every box below is ticked.

---

### W-001: Project initialisation and toolchain

**Goal:** A Next.js 16 + TypeScript (strict) project with ESLint, Prettier, Vitest, Playwright and the full script set, runnable on all platforms.

**Dependencies:** none.

- [x] Initialise Next.js (App Router, TypeScript strict, `src/` directory, path alias `@/*`). Enable `output: 'standalone'` in `next.config`.
- [x] Add `.nvmrc` (`22`) and `engines` in `package.json` (`node >=22.12`, `npm >=10`). pg-boss requires Node 22.12 or newer.
- [x] Add dev dependencies: `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `eslint` (+ Next config), `prettier`, `dependency-cruiser`, `dotenv`, `dotenv-cli`, `cross-env`, `tsx`, `esbuild` (bundles the worker).
- [x] Pin versions deliberately: use the current **stable** majors at install time (for example Prisma 7.x, not a release candidate) and record them in `package.json`.
- [x] Create a placeholder `src/worker/index.ts` (logs that it started, then waits for `SIGTERM`) so `build:worker`, `ci:quality` and the Docker worker work from day one. W-012 replaces it.
- [x] Create `scripts/run-next.mjs`: takes `dev|start` and an env file path, loads it with `dotenv` (values already set in the environment win, so containers work without a `.env`), reads `APP_HOST` and `APP_PORT`, and spawns `next` with `-H` and `-p`. It fails clearly only if required values are missing from both. No hard-coded ports.
- [x] Add every script in the table below to `package.json`.
- [x] Prettier config and `.prettierignore`; `.editorconfig`.
- [x] RED check: `npm run lint`, `typecheck`, `build` run individually on the empty app; `npm run dev` serves on `127.0.0.1:47213` and fails clearly if `.env` is missing.


> **Done 2026-10-30.** Pinned: Next.js 16.4.3, React 19.3.0, TypeScript 5.9.3, ESLint 9.39.5 (eslint-config-next's plugins do not declare ESLint 10 yet), Vitest 5.0.5, Playwright 1.64.1, Prettier 3.9.10, dependency-cruiser 18.7.0, dotenv 18.0.9, dotenv-cli 11.1.0, cross-env 10.1.0, tsx 4.23.15, esbuild 0.28.2, @types/node 22.20.5 (Decision 33). Next's starter enables `cacheComponents`; it is left **off** for now (classic route-handler semantics). `lint:arch` starts with a minimal `.dependency-cruiser.cjs` (no-circular only), so `npm run lint` works; W-003 adds the boundary rules. Scripts for later items (Prisma, tests, Docker, guard) are present and start working as their items land.

**Required `package.json` scripts**

| Script | Command (intent) |
|:---|:---|
| `dev` | `node scripts/run-next.mjs dev .env` |
| `build` | `next build` |
| `build:worker` | `esbuild src/worker/index.ts --bundle --platform=node --packages=external --outfile=dist/worker.js` (confirm flags for the installed esbuild) |
| `worker` | `dotenv run -q --override -f .env -- tsx watch src/worker/index.ts` (development worker) |
| `worker:start` | `node dist/worker.js` (environment comes from the process or container) |
| `build:tools` | `esbuild src/modules/identity/rbac/syncRbac.cli.ts --bundle --platform=node --packages=external --outfile=dist/sync-rbac.js` (production RBAC sync, run inside the migrator image without `tsx` or `.env`) |
| `start` | `node scripts/run-next.mjs start .env` |
| `start:test` | `node scripts/run-next.mjs start .env.test` |
| `lint` | `npm run lint:code && npm run lint:arch && npm run format:check` |
| `lint:code` | `eslint .` |
| `lint:arch` | `depcruise src --config .dependency-cruiser.cjs` |
| `format` / `format:check` | `prettier --write .` / `prettier --check .` |
| `typecheck` | `next typegen && tsc --noEmit` (generates Next.js route types and `next-env.d.ts`, which is git-ignored; confirm the command for the installed Next.js version) |
| `test:unit` | `vitest run --project unit && npm run test:unit:tz` |
| `test:unit:tz` | Runs the time-module tests under `TZ=UTC`, `Asia/Kolkata`, `America/Los_Angeles`, `Pacific/Kiritimati` (via `cross-env`) |
| `test:integration` | `npm run db:test:prepare && vitest run --project integration` |
| `test:e2e` | `npm run db:test:prepare && playwright test` |
| `test` | `npm run test:unit && npm run test:integration && npm run test:e2e` |
| `test:watch` | `vitest --project unit` |
| `ci:quality` | `npm run lint && npm run typecheck && npm run build && npm run build:worker && npm run test:unit && npm run test:integration && npm run test:e2e` |
| `guard:files` | `node scripts/check-forbidden-files.mjs` |
| `db:generate` | `prisma generate` |
| `db:migrate:dev` | `dotenv run -q --override -f .env -- prisma migrate dev` |
| `db:migrate:deploy` | `dotenv run -q --override -f .env -- prisma migrate deploy` |
| `db:migrate:check` | Drift check: `db:test:migrate`, then `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` against the test DB (exit code 2 on drift; no shadow DB needed) |
| `db:test:migrate` | `dotenv run -q --override -f .env.test -- prisma migrate deploy` |
| `db:test:prepare` | `tsx scripts/prepare-test-db.ts` (migrate, RBAC sync, test seed) |
| `db:sync-rbac` | `dotenv run -q --override -f .env -- tsx src/modules/identity/rbac/syncRbac.cli.ts` |
| `db:seed` | `dotenv run -q --override -f .env -- tsx prisma/private/seed.ts` |
| `db:seed:test` | `dotenv run -q --override -f .env.test -- tsx prisma/seed-test.ts` |
| `db:reset:dev` / `db:reset:test` | Reset the DB then re-run migrations (destructive; guarded by env checks) |
| `docker:db:up` / `docker:db:down` | Compose `db` service up / down |
| `docker:db:create:dev` / `docker:db:create:test` | `docker exec ... psql ... CREATE DATABASE ...` |
| `docker:local:up` / `docker:local:logs` / `docker:local:down` | Local full stack: app + worker (`--profile app`) |
| `docker:prod:build` / `docker:prod:up` | Production compose with `--env-file .env.production` |

> The build (app and worker) runs before the tests in `ci:quality`. Each test script is runnable alone. `storage:copy` and `test:contract:s3` are added in Phase 7, when a second storage driver exists.

---

### W-002: Environment, configuration and single source of truth

**Goal:** One validated place for environment values, one place for shared constants, and example env files that work out of the box.

**Dependencies:** W-001.

**RED tests (unit)**
- [x] `getEnv()` throws a clear error when a required value is missing.
- [x] `getEnv()` with `APP_ENV=test` and a database name not ending in `_test` throws "refusing to run".
- [x] `getEnv()` with `APP_ENV=production` and a database name ending in `_test` throws; also rejects the dev placeholder `AUTH_SECRET` in production.
- [x] `APP_CONFIG` exposes product name, company legal name, support email, support phone (E.164) and derived display/`tel:` forms, business timezone, locale, currency; the object is frozen.
- [x] SSOT scan test: fails when an email or phone literal, or the product/company name, appears in `src/` outside `appConfig.ts`, tests and fixtures. (Prove it by temporarily adding a literal.)
- [x] Test that `.env.example`, `.env.test.example` and `.env.production.example` all parse against the env schema (production example with placeholders replaced).
- [x] `getEnv()` validates `TELEPHONY_PROVIDER`, `WHATSAPP_GATEWAY`, `STORAGE_DRIVER` (+ `STORAGE_LOCAL_DIR` for `local`) and `CREDENTIALS_ENCRYPTION_KEY`. With `APP_ENV=production` it refuses `fake` for `TELEPHONY_PROVIDER` and `WHATSAPP_GATEWAY`, and refuses the dev placeholder encryption key.

**GREEN tasks**
- [x] `src/shared/config/env.ts`: Zod-validated, lazy (validated on first use at runtime, **not at import**, so `next build` needs no database or secrets). The only file that reads `process.env`; ESLint forbids `process.env` elsewhere.
- [x] `src/shared/config/appConfig.ts` with placeholder values (`support@example.com`, a clearly fake phone) and a comment that real values are set here only.
- [x] Create `.env.example`, `.env.test.example`, `.env.production.example` exactly as shown in `local_setup.md` Section 3. Use `127.0.0.1` everywhere; web ports 47213 / 47215; Postgres 54329.
- [x] No `NEXT_PUBLIC_*` for environment-specific values.
- [x] Home page and page metadata read `APP_CONFIG` (proves the SSOT is wired).

**Verification:** `lint`, `typecheck`, `build` (with no `.env` present), `test:unit`.

> **Done 2026-10-30.** 23 unit tests (`src/shared/config/__tests__/`, `src/tests/ssot.unit.test.ts`); the SSOT scan and the `process.env` lint rule were each proven by a temporary probe file. Zod 4.6.7 added. A minimal Vitest config (unit project only; renamed to `vitest.config.mts` in W-008) was created here because W-002 needs unit tests before W-008; W-008 extends it. `test:unit:tz` uses `--passWithNoTests` until the time module exists; **W-006 removes that flag**. Production refuses secrets containing the placeholder markers `dev-only`, `test-only` or `change-me`.

---

### W-003: Modular monolith skeleton and the reference module

**Goal:** The folder structure, CSR layering and enforced boundaries exist, proven by a small real module (`system`: health and diagnostics).

**Dependencies:** W-001, W-002.

**RED checks**
- [x] `lint:arch` fails when a deliberately bad import is added (then remove it), for each rule: cross-module internals, controller imported outside `src/app`, Prisma imported outside repositories/seeds/scripts/`shared/db`, `shared` importing a module, UI importing server code, repository importing service, circular import, a telephony provider folder imported outside `providers/registry.server.ts` / `registry.browser.ts`, a server adapter reaching the browser bundle, `src/shared` importing `src/worker` or a module, a storage driver imported outside `shared/storage/registry.ts`, pg-boss imported outside `shared/jobs/`.
- [x] Unit: `system.service` returns status, version and server instant from the injected `Clock`, with a mocked repository.
- [x] Integration: `GET /api/health` returns `200 { data: { status: 'ok', database: 'up', time } }` against the test DB, and `{ database: 'down' }` with status `503` when the database check fails (simulate by a repository stub in a dedicated test).

**GREEN tasks**
- [x] Create the folder layout from `project_data.md` Section 4.2 (empty module folders only get a `.gitkeep` and a README line in `src/modules/README.md`).
- [x] `.dependency-cruiser.cjs` with the import rules from `project_data.md` Section 4.2 (rules 1–5, 7 and 8), plus `no-circular`. Test files (`*.test.ts(x)`, `src/tests/**`) are exempt from the Prisma-import rule (the enum parity test imports generated enums). Rule 6 (a repository writes only its own module's tables) is not an import rule; it is checked in review and by integration tests.
- [x] `src/shared/db/prisma.ts` (client singleton).
- [x] `src/modules/system/`: `system.controller.ts`, `system.service.ts`, `system.repository.ts` (`SELECT 1` health query), `system.schemas.ts`, `index.ts`.
- [x] `src/app/api/health/route.ts` using `route({ access: 'public', ... })` and listed in the public allow-list.
- [x] `src/shared/events/eventBus.ts`: typed in-process publish/subscribe with a unit test (events carry plain serialisable data).
- [x] `src/shared/logger/` with structured logs, `requestId` support and redaction of secrets.
- [x] `src/modules/README.md` documenting the module template and the rules for adding a module.
- [x] Remove `--pass-with-no-tests` from `test:e2e` in `package.json` (added in W-008 part A).
- [x] `e2e/health.e2e.ts`: `GET /api/health` on the built app returns `200` with `status: 'ok'` (moved here from W-008 part A, Decision 34).

**Verification:** `lint` (including `lint:arch`), `typecheck`, `build`, `test:unit`, `test:integration`, `test:e2e`.

> **Done 2026-10-30.** 16 new tests (system service, health integration incl. the 503 stub, event bus, logger, `route()`) plus `e2e/health.e2e.ts`; 42 unit, 8 integration, 1 E2E passing. Every architecture rule proven with a deliberate bad import (16 probes, all removed): module internals from a module and from outside, controller outside `src/app`, Prisma (generated client and `@prisma/client`) outside repositories, `shared` importing a module or the worker, UI importing server code (module `ui/` and an app page), repository importing a service, circular import, telephony provider outside the registries, server adapter reachable from the browser registry, storage driver outside the registry, pg-boss outside `src/shared/jobs/`. The first run showed that excluding `src/generated/` hid rule 3; it is now "do not follow" (Decision 35). `/api/health` builds as dynamic. Design choices in Decision 35.

---

### W-004: Error handling foundation (friendly errors only)

**Goal:** Every failure becomes a friendly, catalog-based message for the user; technical detail stays in the server log.

**Dependencies:** W-003.

**RED tests**
- [x] Unit: `AppError(code)` maps to the catalog message and HTTP status for all eight codes.
- [x] Unit: unknown errors (a thrown `Error`, a Prisma-like error, a string) become `INTERNAL_ERROR` with the generic message; the original is passed to the logger with the `requestId`.
- [x] Unit: Zod validation errors become `VALIDATION_FAILED` with per-field friendly messages; library-default text (e.g. "Expected string, received number") never appears.
- [x] Unit: catalog scan: no message matches the permission-code pattern `^[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*$` or contains words like `prisma`, `sql`, `stack`, `undefined`, `ECONN`.
- [x] Unit: the frontend mapper turns network failure, 401, 403, 404, 429, 5xx and malformed bodies into fixed friendly sentences and ignores any `message` not from the catalog.
- [x] Integration: a diagnostics route that throws (enabled only when `APP_ENV=test`) returns `500` with `{ error: { code: 'INTERNAL_ERROR', message, requestId } }` and no stack or internal text.
- [x] E2E (`e2e/not-found.e2e.ts` written here, moved from W-008 part A, Decision 34): opening an unknown URL shows the friendly not-found page; forcing a server error shows the friendly error page with a "Reference" ID; page text contains none of the banned strings.

**GREEN tasks**
- [x] `src/shared/errors/`: `AppError`, `errorCatalog.ts` (initial codes: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `INTERNAL_ERROR`), `toErrorResponse()`.
- [x] `src/shared/http/route.ts`: the `route({ access, input?, handler })` wrapper: request ID → principal resolution → access check → input parsing → handler → success/error envelope. Defines the shared `ApiResponse<T>` type.
- [x] `src/shared/api/client.ts` and `friendlyError.ts` for the frontend.
- [x] `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx` using the mapper and `APP_CONFIG` for support contact.
- [x] A reusable `<ErrorMessage />` component and a toast helper that accept only mapped friendly text.

**Verification:** `lint`, `typecheck`, `build`, `test:unit`, `test:integration`, `test:e2e`.

> **Done 2026-10-30.** 46 new tests (catalog, `toErrorResponse`, `parseInput`, `route()` errors and input, test-only guard, frontend mapper, API client, `<ErrorMessage />` and toast with Testing Library) plus `e2e/not-found.e2e.ts` and `e2e/server-error.e2e.ts`; 87 unit, 9 integration, 3 E2E passing. Test-only route and page checked by hand: 404 when served with the development `.env`. Not-found page checked in the browser pane. `@testing-library/react` 16.3.3 and `@testing-library/dom` 10.4.2 added. Details in Decision 36.

---

### W-005: RBAC foundation (registry, identity card, guard)

**Goal:** Role-based access control mechanics are in place and proven, so Phase 1 only has to plug in real login.

**Dependencies:** W-003, W-004, W-007 (tables).

**Permissions and roles:** `system:view-diagnostics` (ADMIN by default; SUPER_ADMIN through the bypass). Reserved codes `roles:manage` and `users:manage-super-admins` are registered now (Decision 23).

**RED tests**
- [x] Unit: permission registry integrity: every code is unique, matches `resource:action`, and has a label, description and module; the reserved list contains exactly `roles:manage` and `users:manage-super-admins`.
- [x] Unit: default roles reference only registered codes; no default bundle contains a reserved code; `SUPER_ADMIN` has `bypassesAccess` and an empty bundle; `ADMIN` has `system:view-diagnostics`, `MANAGER` and `AGENT` do not.
- [x] Unit: Super Admin bypass: a principal whose role has `bypassesAccess` passes `can()` for every registered code (including reserved ones) and the scope resolver returns "all"; no code outside the guard and scope resolver reads `bypassesAccess` or compares role codes (scan test).
- [x] Unit: `can(principal, code)` and the guard: allow, deny, `anyOf`, `authenticated`, `public`; default is deny when access is missing.
- [x] Unit: guard-coverage scan: every `src/app/api/**/route.ts` uses `route()` with an `access` value; every `'public'` route is in `publicRoutes.ts`. (Prove by temporarily adding an undeclared route.)
- [x] Integration: `GET /api/diagnostics` with an ADMIN or SUPER_ADMIN principal returns `200`; with a MANAGER principal returns `403` with the generic message and **no permission code in the body**; with no principal returns `401`. The server log for the denial contains the permission code and principal ID.
- [x] Integration: `db:sync-rbac` is idempotent (run twice, identical rows) and follows Decision 23: a **new** registry code is granted to its default roles; a code removed from the registry is deleted with its grants; a grant removed by hand from an existing role stays removed after re-sync; the `SUPER_ADMIN` row is created if missing and never updated.
- [x] Integration: the database trigger rejects inserting a reserved permission into any role, and any grant to the bypass role.
- [x] (The E2E check for the friendly forbidden message lives in W-008's e2e specs; there is no separate page-text scan for permission codes, per Decision 29.)

**GREEN tasks**
- [x] `src/shared/rbac/permissionRegistry.ts` (`PERMISSIONS` const object and `PermissionCode` type, starting with `system:view-diagnostics`).
- [x] `src/shared/rbac/defaultRoles.ts` (`SUPER_ADMIN` with `bypassesAccess: true` and no bundle; `ADMIN`, `MANAGER`, `AGENT` bundles).
- [x] `src/shared/rbac/principal.ts` (the identity card type), `guard.ts`, `assertCan.ts`, `publicRoutes.ts`.
- [x] A `PrincipalResolver` interface in the route wrapper. Phase 0 ships a resolver that returns no principal in production; a **test-only** override is allowed only when `APP_ENV=test` and throws otherwise (unit-tested). Real session-based resolution arrives in Phase 1.
- [x] `src/modules/identity/`: Prisma-backed repository and service for `permissions`, `roles` and `role_permissions` only, and `syncRbac` plus its CLI.
- [x] `src/app/api/diagnostics/route.ts` guarded by `system:view-diagnostics`.
- [x] Frontend `usePrincipal()` stub exposing `can()` for hiding controls (never prints codes).

**Verification:** full chain through `test:e2e`.

> **Phase 1 acceptance reminder:** real login-based RBAC tests (each role against each guarded route, with real sessions) must be added in Phase 1.

> **Done 2026-10-30.** 37 new unit tests (registry, default roles, `can`/`checkAccess`/`assertCan`, bypass and `resolveScope`, test-only resolver override, `usePrincipal` stub, guard-coverage scan, bypass/role-name scan) and 19 integration tests (diagnostics per role incl. the denial log, sync rules, triggers). Scans proven with temporary probes (a route not using `route()`, a public route not allow-listed, a bypass read plus a role-code comparison), all removed. `db:sync-rbac` run twice on `explorehills_dev`: the second run changed nothing; `dist/sync-rbac.js` runs from the bundle after switching the Prisma client to CommonJS. 149 unit, 31 integration (also shuffled), 3 E2E passing. Details in Decision 38.

---

### W-006: Time and timezone foundation

**Goal:** One module owns all date and time logic, so midnight and timezone bugs cannot appear.

**Dependencies:** W-002.

**RED tests (unit, run under the `TZ` matrix)**
- [x] `toBusinessDate`: `2026-12-31T18:35:00Z` → `2027-01-01` for `Asia/Kolkata`; `2026-12-31T18:29:59Z` → `2026-12-31`.
- [x] `businessDayRange('2027-01-01')` → `[2026-12-31T18:30:00Z, 2027-01-01T18:30:00Z)` half-open, and adjacent days neither overlap nor leave gaps.
- [x] A DST zone (set via a test override of the business timezone) produces 23-hour and 25-hour days correctly.
- [x] `formatInstant` output is identical regardless of the machine `TZ`.
- [x] `parseBusinessLocalDateTime('2027-01-01', '00:05')` → the correct UTC instant.
- [x] Business-date round trip: `YYYY-MM-DD` ⇄ Prisma `@db.Date` value ⇄ `YYYY-MM-DD` never shifts a day.
- [x] The injected `Clock` can be frozen and advanced.
- [x] ESLint rule test: `new Date()`, `Date.now()`, `getHours()` and `toLocaleDateString()` outside `src/shared/time/` fail `lint:code`.
- [x] Integration: a record inserted at 23:59 and another at 00:01 business time are returned by the correct "today" query; a daily-bucket SQL using `AT TIME ZONE <business tz>` groups them on different days.

**GREEN tasks**
- [x] Remove `--passWithNoTests` from `test:unit:tz` in `package.json` (added in W-002).
- [x] Add Luxon. `src/shared/time/`: `clock.ts`, `instants.ts`, `businessDate.ts`, `range.ts`, `format.ts`, `formats.ts` (style registry), `index.ts`.
- [x] ESLint `no-restricted-syntax` / `no-restricted-properties` rules banning the listed APIs outside `src/shared/time/**`.
- [x] A short `prisma/CONVENTIONS.md` (or comment block in `schema.prisma`): instants are `@db.Timestamptz(3)`, business dates are `@db.Date`.
- [x] Postgres runs with `timezone=UTC` (already in compose); add an integration test asserting `SHOW timezone` is `UTC`.

**Verification:** `lint`, `typecheck`, `build`, `test:unit` (includes the TZ matrix), `test:integration`.

> **Done 2026-10-30.** Luxon 3.7.2. `src/shared/time/`: `clock.ts` (with `createTestClock`), `instants.ts`, `businessDate.ts`, `range.ts`, `format.ts`, `formats.ts`, `index.ts`. 16 time tests pass under each of the four `TZ` values; 10 lint-rule tests use the ESLint API; 3 integration tests cover `SHOW timezone` = UTC, 23:59 / 00:01 across the 31 Jan → 1 Feb boundary, and `AT TIME ZONE` buckets. The four older tests that built dates directly now use the time module. `prisma/CONVENTIONS.md` was written in W-007. `--passWithNoTests` removed from `test:unit:tz`. Integration suite passes in shuffled order. 113 unit (+64 under the TZ matrix), 12 integration, 3 E2E passing. Details in Decision 37.

---

### W-007: Database foundation and migrations

**Goal:** Prisma is configured, the first migration exists, and migrations are applied automatically wherever the app runs.

**Dependencies:** W-001, W-002, W-010 part A (local Postgres container).

**RED checks**
- [x] `npm run db:test:migrate` on an empty test database applies cleanly; running it again is a no-op.
- [x] `npm run db:migrate:check` passes on a clean tree and **fails** after editing `schema.prisma` without a migration (prove, then revert).
- [x] Integration: after migration the expected tables exist and `_prisma_migrations` lists the baseline migration.

**GREEN tasks**
- [x] Confirm the installed Prisma major version's setup. **Prisma 7** keeps the connection URL in `prisma.config.ts` (not in `schema.prisma`), uses the `prisma-client` generator with an explicit output folder (`src/generated/prisma`, git-ignored), and needs a driver adapter (`@prisma/adapter-pg`) in the client singleton. Follow the installed version's documentation and update these docs if it differs.
- [x] `prisma/schema.prisma` with the generator, datasource, and the first models exactly as in `database_schema.md` 3.1 and 3.6: `IdentityPermission`, `IdentityRole` (with `bypassesAccess`), `IdentityRolePermission`, `SystemWorkerHeartbeat`. Comment each model with its owning module. Cross-module foreign keys are allowed (Decision 22).
- [x] Raw SQL in the baseline migration for the `identity` constraints in `database_schema.md` Section 6 (bypass partial unique index, system-role and reserved-permission triggers).
- [x] Confirm `db:migrate:check` ignores the `pgboss` schema created by the worker (W-012).
- [x] Baseline migration `<timestamp>_init_identity_rbac_system`.
- [x] Prisma client generation output is git-ignored; `postinstall` or the CI step runs `db:generate`.
- [x] Do **not** configure Prisma's automatic seed hook (Decision 11).
- [x] Document the migration rules (naming, never edit applied, expand/contract) at the top of `prisma/CONVENTIONS.md`.

**Verification:** `lint`, `typecheck`, `build`, `test:integration`.

> **Done 2026-10-30.** Prisma 7.10.1 with `@prisma/adapter-pg` 7.10.1 and `pg`; `prisma.config.ts` holds the URL (empty when unset, so `prisma generate` works without a database). Baseline `20261029195608_init_identity_rbac_system` (Prisma stamps migrations in UTC) with the bypass partial unique index and both triggers, each checked by hand in a rolled-back transaction (formal tests in W-005). Drift check proven: exit 0 on a clean tree, exit 2 after adding a field without a migration; a `pgboss` schema is ignored. Integration test `src/tests/db/migrations.int.test.ts` passes (3 tests) via a minimal integration project and `src/tests/setup/loadTestEnv.ts`; until W-008 part A adds `scripts/prepare-test-db.ts`, it runs with `vitest run --project integration` after `db:test:migrate`. `dotenv-cli` 11 syntax change recorded in Decision 33. `db:generate` runs in each CI job (no `postinstall`).

---

### W-008: Test infrastructure (isolated environment)

**Goal:** Unit, integration and E2E each run alone, against the isolated test environment, with no chance of touching dev data.

**Dependencies:** Part A: W-002, W-007. Part B: W-005.

> **Built in two parts** (see the Phase 0 execution order). **Part A**, before W-003: the Vitest projects, env loading and safety guards, `resetDatabase()`, `callRoute()`, the test storage folder, `scripts/prepare-test-db.ts` (migrations only at first; it gains the RBAC sync in W-005 and the test seed in W-009) and `playwright.config.ts`. The health E2E spec is written and ticked in W-003 and the not-found spec in W-004 (Decision 34). **Part B**, after W-005: the test-principal factory (including a Super Admin principal), the test principal override route, and the forbidden E2E spec (the server-error spec and the failure route arrived in W-004, Decision 36).

**RED checks**
- [x] Running `test:integration` with `.env.test` removed fails with a clear message.
- [x] Running the integration setup with `DATABASE_URL` pointing at `explorehills_dev` fails with "refusing to run".
- [x] Prove dev isolation: write a row in a test, then confirm `explorehills_dev` is unchanged.

**GREEN tasks**
- [x] `vitest.config.mts` (`.mts` so Vite loads it as ESM) with three projects: `unit` (`src/**/*.unit.test.ts`, node), `unit-dom` (`src/**/*.unit.test.tsx`, jsdom, for component tests; `test:unit` runs both) and `integration` (`src/**/*.int.test.ts`, node environment, `fileParallelism: false`, global setup that loads `.env.test` with override and asserts the safety guards).
- [x] Part A: `src/tests/setup/` with env loading (`testEnv.ts`, `guards.ts`), a `resetDatabase()` helper (truncate all `public` tables except `_prisma_migrations`, and clear pg-boss jobs), a `callRoute(handler, request)` helper, and a temporary test storage folder cleaned between runs.
- [x] Part B: a test-principal factory in `src/tests/setup/` (including a Super Admin principal). Built in W-005 (`principals.ts`), because W-005's integration tests need it.
- [x] Part A: `scripts/prepare-test-db.ts` loads `.env.test`, asserts guards, runs migrations. Idempotent.
- [x] W-005 adds `syncRbac` to it.
- [ ] W-009 adds the test seed to it.
- [x] `playwright.config.ts`: loads `.env.test`, reads the port from env (note: with `output: 'standalone'`, `next start` prints a warning; either accept it for E2E or start `.next/standalone/server.js` with `HOSTNAME`/`PORT`, and record the choice), `webServer` runs `npm run start:test` against the existing build, `reuseExistingServer` only outside CI, Chromium only, traces on first retry.
- [x] Part B: `e2e/` spec for the forbidden message (`e2e/forbidden.e2e.ts`: manager refused, admin allowed, signed-out asked to sign in, on the new `/diagnostics` page). The health spec is in W-003; the not-found and server-error specs are in W-004 (Decisions 34 and 36).
- [x] Test-only routes (diagnostics failure, test principal override) exist **only** when `APP_ENV=test`, and a unit test proves they are unreachable otherwise. The failure route is from W-004; the principal override is the test-only `eh_test_role` cookie resolver installed by `src/instrumentation.ts` (Decision 39).

**Verification:** run each tier alone, then `npm run test`.

> **Part A done 2026-10-30.** 6 new tests (callRoute, guards, resetDatabase, test storage); 28 unit and 6 integration passing. RED checks proven: with `.env.test` removed and with `DATABASE_URL` set to `explorehills_dev`, both `test:integration` and a direct Vitest run stop with a clear message (the global setup prints the reason itself because Vitest 5 can hide errors thrown there behind a source-map error). Dev isolation proven with a marker row in `explorehills_dev` that was unchanged after `npm run test`. Playwright choice: **accept the `next start` standalone warning** for E2E (it serves normally); proven with a temporary probe spec that was then deleted. `test:e2e` uses `--pass-with-no-tests` until W-003 adds the health spec; **W-003 removes that flag**. jsdom 30.1.3 added. `resetDatabase()` clears pg-boss `job`/`archive` tables when present; W-012 confirms the names.

> **Part B done 2026-10-30.** 8 new unit tests (cookie resolver, configurable resolver, instrumentation installs it only in test) and 3 E2E specs; 155 unit, 31 integration, 6 E2E passing. Checked by hand: a development server ignores the cookie (401 even as `SUPER_ADMIN`). Details in Decision 39.

---

### W-009: Seed strategy

**Goal:** Test seeding and real seeding are completely separate; no secret or real credential is ever in git.

**Dependencies:** W-005, W-007, W-008.

**RED tests**
- [ ] Integration: `seed-test` run twice produces identical data (idempotent). In Phase 0 it seeds RBAC data only; Phase 1 extends it with the super admin, admin, manager and agent users from `.env.test`.
- [ ] Unit: `seed-test` refuses to run when the database name does not end in `_test` or `APP_ENV` is not `test`.
- [ ] Unit: the real seed template refuses a `_test` database and refuses missing or weak `SEED_SUPER_ADMIN_PASSWORD`. (Creating the first Super Admin, and doing nothing if one already exists, is added and tested in Phase 1 when `identity_users` exists.)
- [ ] Script test: `guard:files` fails when a file under `prisma/private/`, or any real `.env*` file, is tracked (use a temporary tracked file, then remove).
- [ ] Scan test: `prisma/seed-test.ts` contains no password literals (values come from env).

**GREEN tasks**
- [ ] `prisma/seed-test.ts` (committed) and `npm run db:seed:test`.
- [ ] `prisma/seed.example.ts` (committed, placeholders only, reads `SEED_SUPER_ADMIN_*` from `.env`) and instructions to copy it to `prisma/private/seed.ts` (git-ignored). `npm run db:seed` runs the private file and fails with a helpful message if it is missing.
- [ ] `scripts/check-forbidden-files.mjs` (`npm run guard:files`) using `git ls-files`.
- [ ] `npm run db:sync-rbac` runs in every environment and contains no secrets.

**Verification:** `lint`, `typecheck`, `test:unit`, `test:integration`, `guard:files`.

---

### W-010: Docker (local and production)

**Goal:** A local Docker setup for the databases (and optionally the app and worker), and a hardened production setup with migrations as a separate step and a separate worker service.

**Dependencies:** Part A (local Postgres container): W-001. Part B (app and worker containers, production images): W-007, W-009.

> **Built in two parts** (see the Phase 0 execution order). Part A is the `db` service and init script only, so W-007 can run migrations.

**RED checks**
- [x] `docker compose -f docker/docker-compose.local.yml up -d db` gives a healthy container with both `explorehills_dev` and `explorehills_test` on a fresh volume; `SHOW timezone` is `UTC`.
- [ ] `--profile app` serves `http://127.0.0.1:47214/api/health` with hot reload working, and the `worker` container starts and stays up (W-001 placeholder; its heartbeat is verified in W-012).
- [ ] `docker compose ... -f docker/docker-compose.prod.yml build` succeeds; the `migrate` service runs before `app` and `worker`; a deliberately failing migration prevents both from starting.
- [ ] Containers reach each other by service name (`db`), with no fixed IP addresses (Decision 29).
- [ ] The production `app` and `worker` containers run as a non-root user with a read-only filesystem; `app` passes its healthcheck; the `storage` volume (used when `STORAGE_DRIVER=local`) is the only writable path besides `/tmp`.

**GREEN tasks**
- [x] Part A: the `db` service, volume and network of `docker/docker-compose.local.yml`, and `docker/postgres/init/01-create-test-db.sql`, exactly as in `local_setup.md` Section 4.
- [ ] Part B: the `app` and `worker` services (profile `app`) added to `docker/docker-compose.local.yml` exactly as in `local_setup.md` Section 4.

> **Part A done 2026-10-30.** Fresh volume: container healthy, `explorehills_dev` and `explorehills_test` both exist, `SHOW timezone` is `UTC` in both, port published on `127.0.0.1:54329` only, no fixed IP. `docker:db:create:dev` / `create:test` report "already exists" on the existing volume (harmless, as documented).
- [ ] `docker/Dockerfile.local`: Node image from `.nvmrc` version (build arg), installs all dependencies, runs `next dev` on `0.0.0.0`.
- [ ] `docker/Dockerfile.prod`: stages `deps` → `builder` (prisma generate + `next build` + `build:worker`) → `migrator` (prisma CLI, `prisma/` directory, runs `migrate deploy`) → `runner` (standalone output, non-root `node` user, `HEALTHCHECK` using `node -e fetch(...)` because slim images have no `wget`, no dev dependencies; sets `HOSTNAME=0.0.0.0` and `PORT` from `APP_PORT`, because the standalone `server.js` reads `PORT`/`HOSTNAME`) → `worker` (production dependencies, `dist/worker.js`, non-root, runs `node dist/worker.js` directly, not through npm, because the filesystem is read-only). The `migrator` stage also contains `prisma.config.ts` (Prisma 7) and `dist/sync-rbac.js` (from `build:tools`). Create `/app/storage` owned by the `node` user so the mounted volume is writable. `ffmpeg` comes from the `ffmpeg-static` package (added in Phase 7), so no system package is needed.
- [ ] `docker/docker-compose.prod.yml` exactly as in `local_setup.md` Section 10.
- [ ] Root `.dockerignore` (node_modules, .next, dist, `.env*`, `prisma/private`, `storage`, tests output, `.git`).
- [ ] All `docker:*` npm scripts from W-001.
- [ ] Keep the Node version in the Dockerfiles in step with `.nvmrc` (use a build arg defaulting to the same major).

**Verification:** commands above, plus `lint` and `build`.

---

### W-011: CI and CD pipelines (GitHub Actions) and `.gitignore`

**Goal:** Every push and pull request runs lint, typecheck, build and the three test tiers as **individual steps/jobs** (never through `ci:quality`), applies migrations automatically, and a deployment scaffold runs migrations before rollout.

**Dependencies:** W-001 to W-010 (W-012 to W-014 extend the same pipeline; re-run it after each).

**RED checks**
- [ ] Open a throwaway pull request that breaks each step in turn (lint error, type error, failing build, failing unit/integration/e2e test, schema change without migration, tracked `prisma/private/x`) and confirm the matching job fails and later jobs do not run.
- [ ] Confirm the `build` job finishes before any test job starts.

**GREEN tasks**
- [ ] Commit the root `.gitignore` provided with these docs (node_modules, `.next`, `dist`, coverage, test results, Playwright output, generated Prisma client, logs, all `.env*` except the three examples, the whole `prisma/private/` folder, and the local `storage/` folder).
- [ ] `.github/workflows/ci.yml` with this structure:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - name: Forbidden files guard
        run: npm run guard:files
      - name: Lint
        run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - name: Typecheck
        run: npm run typecheck

  build:
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - name: Build
        run: npm run build
      - name: Build worker and tools
        run: npm run build:worker && npm run build:tools
      - uses: actions/upload-artifact@v4
        with:
          name: next-build
          path: .next
          include-hidden-files: true
          retention-days: 1

  test-unit:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - run: cp .env.test.example .env.test
      - name: Unit tests
        run: npm run test:unit

  test-integration:
    needs: build
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: explorehills_user
          POSTGRES_PASSWORD: explorehills_password
          POSTGRES_DB: explorehills_test
          TZ: UTC
        ports: ["54329:5432"]
        options: >-
          --health-cmd="pg_isready -U explorehills_user -d explorehills_test"
          --health-interval=5s --health-timeout=3s --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - run: cp .env.test.example .env.test
      - name: Apply migrations (test database)
        run: npm run db:test:migrate
      - name: Check migrations match schema
        run: npm run db:migrate:check
      - name: Integration tests
        run: npm run test:integration

  test-e2e:
    needs: build
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: explorehills_user
          POSTGRES_PASSWORD: explorehills_password
          POSTGRES_DB: explorehills_test
          TZ: UTC
        ports: ["54329:5432"]
        options: >-
          --health-cmd="pg_isready -U explorehills_user -d explorehills_test"
          --health-interval=5s --health-timeout=3s --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - uses: actions/download-artifact@v4
        with: { name: next-build, path: .next }
      - run: cp .env.test.example .env.test
      - name: Apply migrations (test database)
        run: npm run db:test:migrate
      - run: npx playwright install --with-deps chromium
      - name: E2E tests
        run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

> `db:migrate:check` needs no shadow database (confirmed in W-007): it migrates the CI test database and diffs it against `schema.prisma`.

- [ ] `.github/workflows/deploy.yml` scaffold: triggered after a successful CI run on `main` (`workflow_run`), uses a protected `production` environment, builds the production images (`runner` and `worker`), runs the **migrator** against the production `DATABASE_URL` secret **before** rollout, runs the RBAC sync inside the migrator image (`node dist/sync-rbac.js`), then a clearly marked `TODO: deploy step` (app and worker) for the hosting target (decided in Phase 12). If migration fails, the workflow stops.
- [ ] Repository settings (document in the PR): branch protection requiring all CI jobs to pass.

**Verification:** a green pipeline on a real pull request showing six separate jobs in the order above.

---

### W-012: Background jobs foundation (pg-boss and the worker)

**Goal:** The app can enqueue jobs and a separate worker process runs them, with retries, delayed jobs, recurring jobs, a heartbeat and test helpers (Decision 27).

**Dependencies:** W-002, W-003, W-007, W-008.

**Permissions and roles:** worker status shown on the existing diagnostics endpoint (`system:view-diagnostics`).

**Data and time:** `system_worker_heartbeats.lastBeatAt` (instant). pg-boss tables live in the `pgboss` schema. Job scheduling uses the injected `Clock` and the business timezone.

**RED tests**
- [ ] Unit: the job assembler (in `src/worker/`) rejects duplicate job names across modules; `defineJob()` requires a Zod payload schema and a retry policy; an invalid payload is rejected before enqueue.
- [ ] Unit: the in-memory `JobQueue` fake (for unit tests) records enqueued, delayed and cancelled jobs.
- [ ] Integration: a test-only job (registered only when `APP_ENV=test`) is enqueued and `runPendingJobs()` runs it exactly once; enqueuing twice with the same singleton/idempotency key runs it once.
- [ ] Integration: a failing handler is retried per its policy, then ends in the failed state and writes an alert log entry with the `requestId`/job ID.
- [ ] Integration: `enqueueAt(t)` does not run before `t` and runs after the test clock is advanced past `t` (the test-only helper may move pg-boss's start time for due jobs; confirm table and column names for the installed pg-boss version).
- [ ] Integration: the worker writes a heartbeat; `GET /api/diagnostics` reports the worker as `up` when the last beat is recent and `down` when it is older than the threshold.
- [ ] `lint:arch` fails if pg-boss is imported outside `src/shared/jobs/`.

**GREEN tasks**
- [ ] Add `pg-boss`. `src/shared/jobs/`: `JobQueue` interface (`enqueue`, `enqueueAt`, `schedule`, `cancel`), the pg-boss implementation, `defineJob()`, the registry type, and the testing helpers (`runPendingJobs()`, in-memory fake).
- [ ] `src/worker/index.ts`: validates env, starts pg-boss (it creates the `pgboss` schema), collects every module's jobs from their `index.ts` exports (the worker is a composition root; `src/shared` never imports modules), writes a heartbeat through the `system` module service every few seconds, and shuts down gracefully on `SIGTERM`.
- [ ] The web app only enqueues (it never calls `work`).
- [ ] Replace the W-001 placeholder. `npm run worker`, `build:worker` and `worker:start` work; the Docker `worker` container (W-010) now writes a heartbeat; CI still builds it (W-011).
- [ ] Document the job rules (idempotent handlers, retry with backoff, alert on final failure, delayed jobs + sweeper for timeouts) in `src/shared/jobs/README.md`.

**Verification:** `lint`, `typecheck`, `build`, `build:worker`, `test:unit`, `test:integration`; manual: `npm run worker` alongside `npm run dev` shows the heartbeat on the diagnostics endpoint.

---

### W-013: Live updates foundation (Server-Sent Events)

**Goal:** Browsers receive small "something changed" notices in real time from the app or the worker, filtered per user (Decision 28).

**Dependencies:** W-004, W-005, W-008, W-012.

**Permissions and roles:** the stream is `'authenticated'`; each event type declares who may receive it (default deny).

**Data and time:** no tables. Uses Postgres `LISTEN/NOTIFY` on one channel.

**RED tests**
- [ ] Unit: `defineEventType()` and the assembler: event names are unique across modules; each type has a Zod payload schema containing IDs only; an encoded payload over 4 KB is rejected.
- [ ] Unit: the per-user filter drops an event the principal may not receive; an event type without a filter is never delivered (default deny).
- [ ] Integration: an authenticated test principal connects to `GET /api/events/stream` and receives a test event published through `NOTIFY` from a separate database connection (simulating the worker); an unauthenticated request gets `401`.
- [ ] Integration: an event filtered out for a user is not delivered to that user but is delivered to an allowed user.
- [ ] Unit (component): `useLiveEvents()` falls back to polling at the configured interval when the stream errors, and returns to streaming when it reconnects.

**GREEN tasks**
- [ ] Add `pg`. `src/shared/realtime/` (mechanism only, no module imports): `defineEventType()`, `publish()` (NOTIFY), and the relay (one LISTEN connection per app instance fanning out to connected streams). Modules declare their event types and receive filters in `<module>.events.ts` and export them from `index.ts`; the stream route assembles them. Phase 0 defines one test-only event type in the `system` module.
- [ ] `src/app/api/events/stream/route.ts`: Node runtime, dynamic, sends a keep-alive comment every ~25 seconds, closes cleanly on disconnect.
- [ ] Browser hook `useLiveEvents()` with `EventSource`, automatic reconnect, re-fetch on reconnect, and polling fallback (default interval from a constant until `system_settings` exists in Phase 3).
- [ ] Document the reverse-proxy requirement (response buffering off for the stream path) in `local_setup.md` Troubleshooting and the Phase 12 runbook.

**Verification:** `lint`, `typecheck`, `build`, `test:unit`, `test:integration`; manual: a test event published from the worker appears in an open browser tab.

---

### W-014: File storage foundation (interface, local driver, contract suite)

**Goal:** One `FileStorage` interface with a working `local` driver and a reusable contract test suite, so any later driver (S3-compatible, Google Drive) plugs in by configuration (Decision 26).

**Dependencies:** W-002, W-003, W-008.

**Data and time:** no tables. Files under `STORAGE_LOCAL_DIR` (`storage/` locally, git-ignored).

**RED tests**
- [ ] Contract suite (`src/shared/storage/__tests__/storageContract.ts`, reusable for every driver): `put` then `get` returns identical bytes; `exists` is true after `put` and false after `delete`; `delete` of a missing key is a no-op; a 5 MB file streams without being loaded fully into memory; keys containing `..`, a leading `/` or backslashes are rejected; `getTemporaryUrl` returns either a URL or `null`.
- [ ] The `local` driver passes the contract suite against the test storage folder.
- [ ] Unit: the registry returns the driver named by `STORAGE_DRIVER`; an unknown driver fails at startup with a clear (server-log) message.
- [ ] Unit: `local` writes atomically (temporary file then rename), so a crash never leaves a half-written file under the final key.
- [ ] `lint:arch` fails if a driver is imported outside `src/shared/storage/registry.ts`.

**GREEN tasks**
- [ ] `src/shared/storage/`: `FileStorage` interface, `drivers/local.ts`, `registry.ts`, key helper (`buildKey(...)`) that never puts personal data in keys.
- [ ] `storage/` added to `.gitignore` and `.dockerignore`; the production compose file mounts a `storage` volume (W-010).
- [ ] The `s3` driver, `storage:copy` and the optional S3 contract run are built in Phase 7.

**Verification:** `lint`, `typecheck`, `build`, `test:unit`, `test:integration`.

---

### W-015: Phase 0 acceptance (fresh-clone drill)

**Goal:** Prove the whole foundation works for a brand-new developer.

**Dependencies:** W-001 to W-014.

- [ ] On a clean machine or fresh clone: follow `local_setup.md` Section 2 exactly. Every command works as written.
- [ ] `npm run ci:quality` is green, in order: lint → typecheck → build (app + worker) → unit → integration → e2e.
- [ ] `npm run worker` runs beside `npm run dev`; the diagnostics endpoint shows the worker `up`; a live test event reaches an open browser tab; a file written through `FileStorage` lands in `storage/` and is git-ignored.
- [ ] Running `ci:quality` leaves `explorehills_dev` untouched (verify row counts or a marker row).
- [ ] `git status` is clean after the run: nothing generated is untracked-and-unignored.
- [ ] `git ls-files` shows no `.env` (only the three `*.example` files) and nothing under `prisma/private/`.
- [ ] The GitHub pipeline is green with separate jobs.
- [ ] Local Docker full stack (`docker:local:up`) serves the health endpoint on port 47214 and its worker container is `up`.
- [ ] Production image builds and its migrate-then-start order is proven.
- [ ] Docs are in sync: `local_setup.md`, `project_data.md`, `database_schema.md` and `decision_log.md` match what was built (update any drift).
- [ ] Phase 0 set to **DONE** in the Progress Summary, Phase 1 set to **PENDING (next)**.

---

# Phases 1 to 13: High-Level Plan

> **For every phase below:** do not code from this summary. First investigate the current code, then write detailed work items with `TDD_INSTRUCTION_GUIDE.md`, put them in this file under the phase, get the user's approval, and only then execute. Every list or table screen must have correct sorting and filtering on all columns, state kept when going back, smooth scrolling, and friendly errors.

### Phase 1: Identity — PENDING
Users, credentials, sessions, login/logout, the real server-side principal resolver replacing the Phase 0 placeholder, and RBAC proven end to end with real sessions for each role **including SUPER_ADMIN**. Resolve Open Decision 20 (authentication) first and log it (tenancy is resolved: single company, Decision 21). Add lockout and rate limiting on login. Extend the test seed with users (`database_schema.md` Section 10) and make the real seed create the first Super Admin. Add the `audit_events` table and writer so user and role changes are audited from now on. Enforce the Super Admin protections from Decision 23 on user changes: at least one active Super Admin always; an Admin cannot create, edit, deactivate or promote a Super Admin (`users:manage-super-admins` is reserved). Users are deactivated, never hard-deleted (Decision 22). E2E journey 1 (log in as each role).

### Phase 2: Teams, Hierarchy and the Roles & Permissions Page — PENDING
Manager → agent hierarchy, teams, scope resolution (`getVisibleAgentIds`, with Super Admin resolving to "all"), user management screens, and the **Roles & Permissions page** (Super Admin only, `roles:manage` reserved), exactly as in Decision 23:
- list roles with user counts; create, rename and delete custom roles (deleting a role still held by users → `CONFLICT`);
- edit the permissions of every role except `SUPER_ADMIN`, including `ADMIN`; permissions grouped by module with human-readable labels and descriptions (codes only as small secondary text on this page);
- "Reset to defaults" for system roles; every change audited; changes apply on the user's next request;
- tests: reserved codes cannot be granted; Admin cannot open the page; edits survive `db:sync-rbac`; E2E journey 7 (Super Admin edits a role and the change applies).

### Phase 3: Lead Core — PENDING
Lead and contact records, pipeline stages as configuration, travel-specific custom fields, notes, tasks and follow-ups (business dates), lead list and detail screens with full sorting, filtering and back-button state preserved, scoped by own/team/all. Cross-module foreign keys to `identity_users` with `Restrict` (Decision 22). "Unassigned" means `ownerUserId = null`, not a stage. Adds `system_settings` with the defaults in `database_schema.md` Section 10.

### Phase 4: WhatsApp Integration — PENDING
Resolve Open Decision 19 (direct Meta API or provider) and the SMS question in `project_data.md` Section 11. Webhook with signature verification → raw event stored → processing **job** (Decision 27), idempotent by Meta message ID; lead creation and duplicate merge by E.164 phone; conversation inbox with **live updates** (Decision 28); 24-hour window enforcement; templates; opt-in capture; delivery status; media stored through `FileStorage`; `WhatsAppGateway` interface with a `fake` gateway and a contract suite. E2E journey 4.

### Phase 5: Manager Queue and Assignment Engine — PENDING
Unassigned queue, bulk selection, all six modes (manual, round-robin, least-loaded, priority, random, blast), preview before confirm, atomic claim pool with the `assignment_pool_eligibility` join table, caps, shifts and eligibility, timeouts with return-to-pool or escalation as **delayed jobs plus a sweeper** (Decision 27), pool expiry jobs, idempotent assignment, audit events, **live updates** so a claimed lead disappears for other agents and new leads appear in the queue. Heavy concurrency tests. E2E journeys 2 and 3.

### Phase 6: Agent Workspace — PENDING
"My leads" screen, lead record with chat panel, notes, call outcome (disposition) form, trip details, follow-up tasks, pool claiming UI, quick filters, keyboard-friendly layout, live updates. Reserve the place for the softphone panel and call card; the calling itself arrives in Phase 7.

### Phase 7: Browser Calling, Call Logging and Recordings — PENDING
Design: Decisions 24, 25, 26. Build in this order, so nothing waits on the provider choice:
1. `TelephonyProvider` (server) and `SoftphoneClient` (browser) interfaces, capability flags, normalised `TelephonyCallStatus`, the two provider registries (`registry.server.ts`, server-only; `registry.browser.ts`), and the **`fake` provider** (server + browser) with the shared **contract test suite**.
2. Outbound browser calling from a lead: `callRef`, short-lived agent credentials, softphone panel, live call card (softphone events + SSE), call outcome form, call timeline entries, "call via my phone" fallback when the provider has `clickToCall`.
3. Webhooks → raw event log → processing job (idempotent by provider event ID); match by `callRef`, then by phone.
4. Inbound calls (when `inboundRouting`): route to the lead owner if online, else `telephony.inboundFallback`; incoming-call pop-up; unknown numbers create a `PHONE`-source lead.
5. Recordings: download-and-compress job (mono MP3 ~24 kbps via `ffmpeg-static`), `telephony_recordings` metadata, playback with `telephony:view-recordings` + scope (signed link or streamed), audited playback, retention job.
6. The `s3` storage driver (any S3-compatible service, cloud or self-hosted on a VPS), `npm run storage:copy`, and the optional `test:contract:s3` suite against a local S3-compatible container.
7. **Decision 30 (calling provider) must be made before this step:** the first real provider adapter, passing the contract suite with recorded webhook fixtures; agent endpoint credentials encrypted (`CREDENTIALS_ENCRYPTION_KEY`).
E2E journeys 5 and 6 (fake provider). No test ever calls a real provider.

### Phase 8: Notifications and SLA Automation — PENDING
In-app, email and push notifications, SLA timers (first response, follow-up due), reminders using business-timezone days, escalation rules. All timers and reminders are jobs on the Phase 0 job foundation (W-012); notifications are pushed live (W-013).

### Phase 9: Reports and Dashboards — PENDING
Own/team/company dashboards, volume, assignment and response-time reports, conversion funnel, exports, daily buckets in the business timezone, performance tests on realistic data volumes.

### Phase 10: Audit, Data Protection and Retention — PENDING
Audit trail views (the table and writer exist since Phase 1), consent records, retention and deletion policies as scheduled jobs (recordings, messages, webhook logs, sessions), erasure that also deletes files from `FileStorage`, data export on request, DPDP readiness checklist including the call-recording announcement and notice, privacy notices sourced from `APP_CONFIG`, log redaction review.

### Phase 11: Hardening, Observability and Performance — PENDING
Security review and penetration test fixes, rate limiting, security headers, structured logging and metrics, error tracking, job-queue monitoring (failed and stuck jobs, worker down alerts), live-update connection load test, database indexing review, load tests, accessibility pass, backup and restore drill (database **and** recording storage).

### Phase 12: Production Deployment and Runbook — PENDING
Choose the hosting target (must be always-on for the worker and live updates; a VPS fits), finish the `deploy.yml` rollout step for `app` and `worker`, production secrets management (provider keys, storage keys, `CREDENTIALS_ENCRYPTION_KEY`), domain and HTTPS (required for browser microphone access), reverse proxy with buffering off for `/api/events/stream`, the recording storage target and its off-server backup (Decision 31), first production seed (first Super Admin) by an operator, monitoring and alerts, rollback procedure, and an operations runbook.

### Phase 13: Future — WhatsApp Calling Inside the Platform — DEFERRED
Only if the business decides to add it. Evaluate the three routes in Decision 18 (buy through a provider, build a media layer, hybrid), plug into the existing call adapter, add permission-request flow, recording and consent handling, and cost review.
