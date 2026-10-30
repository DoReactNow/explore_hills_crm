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
| 0 | Foundation: structure, tooling, tests, CI/CD, Docker, conventions, background jobs, live updates, file storage | **DONE** (2026-10-30) |
| 1 | Identity: users, sessions, real RBAC end to end | **PENDING (next)** |
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

# Phase 0: Foundation — DONE

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
| `db:seed` | `dotenv run -q --override -f .env -- tsx scripts/run-real-seed.ts` (runs `prisma/private/seed.ts`, or explains how to create it) |
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
- [x] W-009 adds the test seed to it.
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
- [x] Integration: `seed-test` run twice produces identical data (idempotent). In Phase 0 it seeds RBAC data only; Phase 1 extends it with the super admin, admin, manager and agent users from `.env.test`.
- [x] Unit: `seed-test` refuses to run when the database name does not end in `_test` or `APP_ENV` is not `test`.
- [x] Unit: the real seed template refuses a `_test` database and refuses missing or weak `SEED_SUPER_ADMIN_PASSWORD`. (Creating the first Super Admin, and doing nothing if one already exists, is added and tested in Phase 1 when `identity_users` exists.)
- [x] Script test: `guard:files` fails when a file under `prisma/private/`, or any real `.env*` file, is tracked (use a temporary tracked file, then remove).
- [x] Scan test: `prisma/seed-test.ts` contains no password literals (values come from env).

**GREEN tasks**
- [x] `prisma/seed-test.ts` (committed) and `npm run db:seed:test`.
- [x] `prisma/seed.example.ts` (committed, placeholders only, reads `SEED_SUPER_ADMIN_*` from `.env`) and instructions to copy it to `prisma/private/seed.ts` (git-ignored). `npm run db:seed` runs the private file and fails with a helpful message if it is missing.
- [x] `scripts/check-forbidden-files.mjs` (`npm run guard:files`) using `git ls-files`.
- [x] `npm run db:sync-rbac` runs in every environment and contains no secrets.

**Verification:** `lint`, `typecheck`, `test:unit`, `test:integration`, `guard:files`.

> **Done 2026-10-30.** 12 new tests (seed targets, password and email policy, no password literals in committed seed files, forbidden-file rules, test seed idempotent). Commands checked by hand: `db:seed:test` twice, and refused against the dev database; `db:seed` without a private file prints how to create it; with the template copied it refuses the placeholder password and accepts a strong one (copy deleted afterwards); `guard:files` fails with force-added `.env.local` and `prisma/private/probe.ts`, then passes once they are removed. `prepare-test-db` now runs the test seed. 166 unit, 32 integration, 6 E2E passing. Details in Decision 40.

---

### W-010: Docker (local and production)

**Goal:** A local Docker setup for the databases (and optionally the app and worker), and a hardened production setup with migrations as a separate step and a separate worker service.

**Dependencies:** Part A (local Postgres container): W-001. Part B (app and worker containers, production images): W-007, W-009.

> **Built in two parts** (see the Phase 0 execution order). Part A is the `db` service and init script only, so W-007 can run migrations.

**RED checks**
- [x] `docker compose -f docker/docker-compose.local.yml up -d db` gives a healthy container with both `explorehills_dev` and `explorehills_test` on a fresh volume; `SHOW timezone` is `UTC`.
- [x] `--profile app` serves `http://127.0.0.1:47214/api/health` with hot reload working, and the `worker` container starts and stays up (W-001 placeholder; its heartbeat is verified in W-012).
- [x] `docker compose ... -f docker/docker-compose.prod.yml build` succeeds; the `migrate` service runs before `app` and `worker`; a deliberately failing migration prevents both from starting.
- [x] Containers reach each other by service name (`db`), with no fixed IP addresses (Decision 29).
- [x] The production `app` and `worker` containers run as a non-root user with a read-only filesystem; `app` passes its healthcheck; the `storage` volume (used when `STORAGE_DRIVER=local`) is the only writable path besides `/tmp`.

**GREEN tasks**
- [x] Part A: the `db` service, volume and network of `docker/docker-compose.local.yml`, and `docker/postgres/init/01-create-test-db.sql`, exactly as in `local_setup.md` Section 4.
- [x] Part B: the `app` and `worker` services (profile `app`) added to `docker/docker-compose.local.yml` exactly as in `local_setup.md` Section 4.

> **Part A done 2026-10-30.** Fresh volume: container healthy, `explorehills_dev` and `explorehills_test` both exist, `SHOW timezone` is `UTC` in both, port published on `127.0.0.1:54329` only, no fixed IP. `docker:db:create:dev` / `create:test` report "already exists" on the existing volume (harmless, as documented).
- [x] `docker/Dockerfile.local`: Node image from `.nvmrc` version (build arg), installs all dependencies, runs `next dev` on `0.0.0.0`.
- [x] `docker/Dockerfile.prod`: stages `deps` → `builder` (prisma generate + `next build` + `build:worker`) → `migrator` (prisma CLI, `prisma/` directory, runs `migrate deploy`) → `runner` (standalone output, non-root `node` user, `HEALTHCHECK` using `node -e fetch(...)` because slim images have no `wget`, no dev dependencies; sets `HOSTNAME=0.0.0.0` and `PORT` from `APP_PORT`, because the standalone `server.js` reads `PORT`/`HOSTNAME`) → `worker` (production dependencies, `dist/worker.js`, non-root, runs `node dist/worker.js` directly, not through npm, because the filesystem is read-only). The `migrator` stage also contains `prisma.config.ts` (Prisma 7) and `dist/sync-rbac.js` (from `build:tools`). Create `/app/storage` owned by the `node` user so the mounted volume is writable. `ffmpeg` comes from the `ffmpeg-static` package (added in Phase 7), so no system package is needed.
- [x] `docker/docker-compose.prod.yml` exactly as in `local_setup.md` Section 10.
- [x] Root `.dockerignore` (node_modules, .next, dist, `.env*`, `prisma/private`, `storage`, tests output, `.git`).
- [x] All `docker:*` npm scripts from W-001.
- [x] Keep the Node version in the Dockerfiles in step with `.nvmrc` (use a build arg defaulting to the same major).

**Verification:** commands above, plus `lint` and `build`.

> **Part B done 2026-10-30.** Local full stack: `docker:local:up` builds and starts db, app and worker; `127.0.0.1:47214/api/health` returns ok with the database reached as `db`; a host edit to the home page was served within about 4 s (hot reload); the worker stays up. Production drill against a throwaway `explorehills_prodcheck` database and a temporary git-ignored `.env.production` (both removed afterwards): images build; `migrate` exits 0 before `app` and `worker` start; `app` becomes healthy through the real database; `app` and `worker` run as `node` (uid 1000) on a read-only filesystem where only `/app/storage` and `/tmp` (plus the app's Next cache) are writable; `node dist/sync-rbac.js` in the migrator image creates the four roles. A deliberately invalid migration made `migrate` exit 1 (P3018) and `app` and `worker` stayed in Created. Found and fixed: the Next cache tmpfs was root-owned (now `uid=1000`), and the Prisma CLI warned about missing OpenSSL (now installed in the CLI stages). 6 Docker scan tests; 172 unit, 32 integration, 6 E2E passing. Details in Decision 41.

---

### W-011: CI and CD pipelines (GitHub Actions) and `.gitignore`

**Goal:** Every push and pull request runs lint, typecheck, build and the three test tiers as **individual steps/jobs** (never through `ci:quality`), applies migrations automatically, and a deployment scaffold runs migrations before rollout.

**Dependencies:** W-001 to W-010 (W-012 to W-014 extend the same pipeline; re-run it after each).

**RED checks**
- [x] Open a throwaway pull request that breaks each step in turn (lint error, type error, failing build, failing unit/integration/e2e test, schema change without migration, tracked `prisma/private/x`) and confirm the matching job fails and later jobs do not run.
- [x] Confirm the `build` job finishes before any test job starts.

**GREEN tasks**
- [x] Commit the root `.gitignore` provided with these docs (node_modules, `.next`, `dist`, coverage, test results, Playwright output, generated Prisma client, logs, all `.env*` except the three examples, the whole `prisma/private/` folder, and the local `storage/` folder).
- [x] `.github/workflows/ci.yml` with this structure:

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

- [x] `.github/workflows/deploy.yml` scaffold: triggered after a successful CI run on `main` (`workflow_run`), uses a protected `production` environment, builds the production images (`runner` and `worker`), runs the **migrator** against the production `DATABASE_URL` secret **before** rollout, runs the RBAC sync inside the migrator image (`node dist/sync-rbac.js`), then a clearly marked `TODO: deploy step` (app and worker) for the hosting target (decided in Phase 12). If migration fails, the workflow stops.
- [x] Repository settings (document in the PR): branch protection requiring all CI jobs to pass.

**Verification:** a green pipeline on a real pull request showing six separate jobs in the order above.

> **Done 2026-10-30.** Merged in PR #1 (https://github.com/DoReactNow/explore_hills_crm/pull/1): all six jobs passed, and `build` finished (21:50:13) before the first test job started (21:50:16). Actions use the current majors (checkout v7, setup-node v7, upload-artifact v7, download-artifact v8) with `persist-credentials: false`. Eight throwaway PRs (#2–#9, closed, branches deleted) each broke one step, and each failed exactly there with the later jobs skipped: lint → Lint; typecheck → Typecheck; build → Build; test-unit → Unit tests; test-integration → Integration tests; test-e2e → E2E tests; schema change without a migration → test-integration › Check migrations match schema; tracked `prisma/private/x.ts` → lint › Forbidden files guard. `deploy.yml` runs only when the repository variable `DEPLOY_ENABLED` is `true` and reads the secret `PRODUCTION_ENV` (Docker env-file format). Branch protection switched on 2026-10-30 with the owner's approval: `main` needs a pull request, the six checks above, and an up-to-date branch; it applies to admins too, and force-pushes and deletion are blocked. From now on every change reaches `main` through a pull request.

---

### W-012: Background jobs foundation (pg-boss and the worker)

**Goal:** The app can enqueue jobs and a separate worker process runs them, with retries, delayed jobs, recurring jobs, a heartbeat and test helpers (Decision 27).

**Dependencies:** W-002, W-003, W-007, W-008.

**Permissions and roles:** worker status shown on the existing diagnostics endpoint (`system:view-diagnostics`).

**Data and time:** `system_worker_heartbeats.lastBeatAt` (instant). pg-boss tables live in the `pgboss` schema. Job scheduling uses the injected `Clock` and the business timezone.

**RED tests**
- [x] Unit: the job assembler (in `src/worker/`) rejects duplicate job names across modules; `defineJob()` requires a Zod payload schema and a retry policy; an invalid payload is rejected before enqueue.
- [x] Unit: the in-memory `JobQueue` fake (for unit tests) records enqueued, delayed and cancelled jobs.
- [x] Integration: a test-only job (registered only when `APP_ENV=test`) is enqueued and `runPendingJobs()` runs it exactly once; enqueuing twice with the same singleton/idempotency key runs it once.
- [x] Integration: a failing handler is retried per its policy, then ends in the failed state and writes an alert log entry with the `requestId`/job ID.
- [x] Integration: `enqueueAt(t)` does not run before `t` and runs after the test clock is advanced past `t` (the test-only helper may move pg-boss's start time for due jobs; confirm table and column names for the installed pg-boss version).
- [x] Integration: the worker writes a heartbeat; `GET /api/diagnostics` reports the worker as `up` when the last beat is recent and `down` when it is older than the threshold.
- [x] `lint:arch` fails if pg-boss is imported outside `src/shared/jobs/`.

**GREEN tasks**
- [x] Add `pg-boss`. `src/shared/jobs/`: `JobQueue` interface (`enqueue`, `enqueueAt`, `schedule`, `cancel`), the pg-boss implementation, `defineJob()`, the registry type, and the testing helpers (`runPendingJobs()`, in-memory fake).
- [x] `src/worker/index.ts`: validates env, starts pg-boss (it creates the `pgboss` schema), collects every module's jobs from their `index.ts` exports (the worker is a composition root; `src/shared` never imports modules), writes a heartbeat through the `system` module service every few seconds, and shuts down gracefully on `SIGTERM`.
- [x] The web app only enqueues (it never calls `work`).
- [x] Replace the W-001 placeholder. `npm run worker`, `build:worker` and `worker:start` work; the Docker `worker` container (W-010) now writes a heartbeat; CI still builds it (W-011).
- [x] Document the job rules (idempotent handlers, retry with backoff, alert on final failure, delayed jobs + sweeper for timeouts) in `src/shared/jobs/README.md`.

**Verification:** `lint`, `typecheck`, `build`, `build:worker`, `test:unit`, `test:integration`; manual: `npm run worker` alongside `npm run dev` shows the heartbeat on the diagnostics endpoint.

> **Done 2026-10-30.** pg-boss 12.38.0. 17 new unit tests (`defineJob`, payload validation, fake queue, assembler, keyed job IDs, worker job list, worker status) and 9 integration tests (run once, idempotency key, invalid payload, retries then final failure with one alert, delayed job with the clock advanced, cancel, heartbeat and diagnostics up/down). 189 unit, 41 integration (also four shuffled orders), 6 E2E passing. Checked by hand: the bundled `dist/worker.js` against the dev database creates the `pgboss` schema, writes a heartbeat every 5 s and exits 0 on SIGTERM; with a worker on the test database, `GET /api/diagnostics` as admin reports `worker: up`; the Docker `worker` container writes heartbeats under its container ID. Found and fixed: pg-boss's `singletonKey` alone does not deduplicate (keyed job IDs instead); the local Docker worker was missing `APP_HOST`/`APP_PORT`/`APP_URL`; the Docker dependency volume must be recreated after a dependency change (troubleshooting note in `local_setup.md`). Details in Decision 42.

---

### W-013: Live updates foundation (Server-Sent Events)

**Goal:** Browsers receive small "something changed" notices in real time from the app or the worker, filtered per user (Decision 28).

**Dependencies:** W-004, W-005, W-008, W-012.

**Permissions and roles:** the stream is `'authenticated'`; each event type declares who may receive it (default deny).

**Data and time:** no tables. Uses Postgres `LISTEN/NOTIFY` on one channel.

**RED tests**
- [x] Unit: `defineEventType()` and the assembler: event names are unique across modules; each type has a Zod payload schema containing IDs only; an encoded payload over 4 KB is rejected.
- [x] Unit: the per-user filter drops an event the principal may not receive; an event type without a filter is never delivered (default deny).
- [x] Integration: an authenticated test principal connects to `GET /api/events/stream` and receives a test event published through `NOTIFY` from a separate database connection (simulating the worker); an unauthenticated request gets `401`.
- [x] Integration: an event filtered out for a user is not delivered to that user but is delivered to an allowed user.
- [x] Unit (component): `useLiveEvents()` falls back to polling at the configured interval when the stream errors, and returns to streaming when it reconnects.

**GREEN tasks**
- [x] Add `pg`. `src/shared/realtime/` (mechanism only, no module imports): `defineEventType()`, `publish()` (NOTIFY), and the relay (one LISTEN connection per app instance fanning out to connected streams). Modules declare their event types and receive filters in `<module>.events.ts` and export them from `index.ts`; the stream route assembles them. Phase 0 defines one test-only event type in the `system` module.
- [x] `src/app/api/events/stream/route.ts`: Node runtime, dynamic, sends a keep-alive comment every ~25 seconds, closes cleanly on disconnect.
- [x] Browser hook `useLiveEvents()` with `EventSource`, automatic reconnect, re-fetch on reconnect, and polling fallback (default interval from a constant until `system_settings` exists in Phase 3).
- [x] Document the reverse-proxy requirement (response buffering off for the stream path) in `local_setup.md` Troubleshooting and the Phase 12 runbook.

**Verification:** `lint`, `typecheck`, `build`, `test:unit`, `test:integration`; manual: a test event published from the worker appears in an open browser tab.

> **Done 2026-10-30.** 19 new unit tests (event types, size limit, default deny, filters, `useLiveEvents` fallback and reconnect, the worker status event) and 3 integration tests (401; a notice sent by `pg_notify` on another connection reaches the stream; the per-user filter delivers to one user and skips the other). Checked in the browser pane against the built app (test env, admin test cookie): the diagnostics page showed `Worker: down` and `Live updates: live`; starting the worker switched it to `Worker: up` with no reload (1 navigation, 2 fetches). The reverse-proxy note was already in `local_setup.md` Section 10 and the Phase 12 summary; the troubleshooting entry now also lists the keep-alive, `X-Accel-Buffering` and the `live`/`polling` status. Details in Decision 43.

---

### W-014: File storage foundation (interface, local driver, contract suite)

**Goal:** One `FileStorage` interface with a working `local` driver and a reusable contract test suite, so any later driver (S3-compatible, Google Drive) plugs in by configuration (Decision 26).

**Dependencies:** W-002, W-003, W-008.

**Data and time:** no tables. Files under `STORAGE_LOCAL_DIR` (`storage/` locally, git-ignored).

**RED tests**
- [x] Contract suite (`src/shared/storage/__tests__/storageContract.ts`, reusable for every driver): `put` then `get` returns identical bytes; `exists` is true after `put` and false after `delete`; `delete` of a missing key is a no-op; a 5 MB file streams without being loaded fully into memory; keys containing `..`, a leading `/` or backslashes are rejected; `getTemporaryUrl` returns either a URL or `null`.
- [x] The `local` driver passes the contract suite against the test storage folder.
- [x] Unit: the registry returns the driver named by `STORAGE_DRIVER`; an unknown driver fails at startup with a clear (server-log) message.
- [x] Unit: `local` writes atomically (temporary file then rename), so a crash never leaves a half-written file under the final key.
- [x] `lint:arch` fails if a driver is imported outside `src/shared/storage/registry.ts`.

**GREEN tasks**
- [x] `src/shared/storage/`: `FileStorage` interface, `drivers/local.ts`, `registry.ts`, key helper (`buildKey(...)`) that never puts personal data in keys.
- [x] `storage/` added to `.gitignore` and `.dockerignore`; the production compose file mounts a `storage` volume (W-010).
> Not part of Phase 0: the `s3` driver, `storage:copy` and the optional S3 contract run are built in Phase 7 (Phase 7 plan, step 6).

**Verification:** `lint`, `typecheck`, `build`, `test:unit`, `test:integration`.

> **Done 2026-10-30.** 22 new unit tests (keys, registry, atomic writes, instrumentation startup check) and the 13-case contract suite passing for the `local` driver against `storage/test`. Atomic write proven with a source that fails after 1 MB: no file under the key and no temporary file left, and an existing file survives a failed overwrite. The architecture rule was re-proven against the real driver file. Checked by hand: a file written through `getFileStorage()` with the development `.env` landed in `storage/uploads/2026/10/<uuid>.txt` and is git-ignored. The `s3` driver, `storage:copy` and the S3 contract run stay with Phase 7 (now a note in this item, since it is not Phase 0 work). Details in Decision 44.

---

### W-015: Phase 0 acceptance (fresh-clone drill)

**Goal:** Prove the whole foundation works for a brand-new developer.

**Dependencies:** W-001 to W-014.

- [x] On a clean machine or fresh clone: follow `local_setup.md` Section 2 exactly. Every command works as written.
- [x] `npm run ci:quality` is green, in order: lint → typecheck → build (app + worker) → unit → integration → e2e.
- [x] `npm run worker` runs beside `npm run dev`; the diagnostics endpoint shows the worker `up`; a live test event reaches an open browser tab; a file written through `FileStorage` lands in `storage/` and is git-ignored.
- [x] Running `ci:quality` leaves `explorehills_dev` untouched (verify row counts or a marker row).
- [x] `git status` is clean after the run: nothing generated is untracked-and-unignored.
- [x] `git ls-files` shows no `.env` (only the three `*.example` files) and nothing under `prisma/private/`.
- [x] The GitHub pipeline is green with separate jobs.
- [x] Local Docker full stack (`docker:local:up`) serves the health endpoint on port 47214 and its worker container is `up`.
- [x] Production image builds and its migrate-then-start order is proven.
- [x] Docs are in sync: `local_setup.md`, `project_data.md`, `database_schema.md` and `decision_log.md` match what was built (update any drift).
- [x] Phase 0 set to **DONE** in the Progress Summary, Phase 1 set to **PENDING (next)**.

> **Done 2026-10-30.** Fresh clone of `main` at `f33b3f2`, following `local_setup.md` Section 2: every step worked once `npm run db:generate` was added after `npm ci` (the drill failed at `db:sync-rbac` without it; Decision 45). `npm run ci:quality` passed in order (lint → typecheck → build → build:worker → 230 unit + the TZ matrix → 57 integration → 6 E2E). `explorehills_dev` was unchanged afterwards (same row counts, marker row intact); `git status` was clean; only the three `*.example` env files and nothing under `prisma/private/` are tracked. `npm run dev` served health OK and `npm run worker` heartbeated beside it (diagnostics answers 401 in development until sign-in arrives in Phase 1). Against the test environment, `GET /api/diagnostics` reported `worker: up`, and an open browser tab switched to "Worker: up" without a reload when the worker started (a live notice from the worker). A file written through `getFileStorage()` landed in `storage/` and is git-ignored. GitHub: the latest CI run on `main` passed all six jobs with `build` before the tests; the deploy workflow was skipped, as designed. Docker: with fresh dependency volumes, `docker:local:up` served health on 47214 and the worker container heartbeated; the production images built from the clone, `migrate` exited 0 before `app` and `worker` started, the app was healthy and the worker heartbeated (temporary database and env file removed afterwards). Docs: three gaps fixed in `local_setup.md` (the generate step, the Playwright browser, and "complete Section 2 first" for the Docker stack); the other documents match what was built.

---

# Phases 1 to 13: High-Level Plan

> **For every phase below:** do not code from this summary. First investigate the current code, then write detailed work items with `TDD_INSTRUCTION_GUIDE.md`, put them in this file under the phase, get the user's approval, and only then execute. Every list or table screen must have correct sorting and filtering on all columns, state kept when going back, smooth scrolling, and friendly errors.

### Phase 1: Identity — PENDING (next)
Users, credentials, sessions, login/logout, the real server-side principal resolver replacing the Phase 0 placeholder, and RBAC proven end to end with real sessions for each role **including SUPER_ADMIN**. Decision 20 (authentication) is resolved by Decision 46; tenancy is resolved (single company, Decision 21). Add lockout and rate limiting on login. Extend the test seed with users (`database_schema.md` Section 10) and make the real seed create the first Super Admin. Add the `audit_events` table and writer so user and role changes are audited from now on. Enforce the Super Admin protections from Decision 23 on user changes: at least one active Super Admin always; an Admin cannot create, edit, deactivate or promote a Super Admin (`users:manage-super-admins` is reserved). Users are deactivated, never hard-deleted (Decision 22). E2E journey 1 (log in as each role).

> **Detailed plan written and approved by the owner on 2026-10-30.** Decision 20 is resolved by Decision 46 (own sessions table, 12-hour sliding sessions capped at 7 days, 15-minute lock after 5 wrong passwords). Execution order: `W-101 → W-102 → W-103 → W-104 → W-105 → W-106 → W-107 → W-108 → W-109 → W-110 → W-111`. Every item goes through a branch and a pull request with all six CI jobs green.

**Before W-102 continues (Decision 47):** map every Phase 1 scenario in `test_scenarios.md` to a work item by its ID, answer Phase 1's open questions, and get the owner's approval of the revised plan. W-101 is complete.

- [ ] Phase 1 plan revised against `test_scenarios.md` and re-approved by the owner
- [ ] Create the missing `scripts/reset-db.ts` behind `db:reset:dev` and `db:reset:test` (`P0-OPS-01`, `P0-OPS-02`). W-001 and W-015 were ticked with this gap; it was found on 2026-10-30.

**Definition of done for Phase 1:** a person signs in with email and password, works under their role's permissions, and signs out; the Super Admin protections hold; every user change and sign-in event is audited; RBAC is proven end to end with real sessions for every role, including `SUPER_ADMIN`; every box below is ticked.

---

### W-101: Identity and audit tables

**Goal:** The database holds staff users, their sessions, sign-in throttling counters and the append-only audit trail.

**Why now / dependencies:** Phase 0 done. Everything else in Phase 1 needs these tables.

**Permissions and roles:** None (schema only).

**Data and time:** New tables (`database_schema.md` 3.1 and 3.6): `identity_users` (instants `createdAt`, `updatedAt`, `lastLoginAt`, `lockedUntil`, `deactivatedAt`; Phase 2 columns `managerId`/`teamId` left out until Phase 2), `identity_sessions` (instants `expiresAt`, `lastSeenAt`, `revokedAt`, `createdAt`), `identity_login_throttle` (new: `key` = hashed IP, `windowStart` instant, `count`), `audit_events` (instant `occurredAt`). Back-relations `IdentityRole.users`, `IdentityUser.sessions`, `IdentityUser.auditEvents`.

**Errors the user can see:** None.

**Module boundaries:** `identity` owns users, sessions and throttle; `audit` owns `audit_events`. Cross-module FK `audit_events.actorUserId → identity_users.id` (`Restrict`). `identity_users.roleId → identity_roles.id` (`Restrict`, same module). `identity_sessions.userId → identity_users.id` (`Cascade`, same module).

**Jobs, live updates, adapters:** None.

#### Step 1: Schema and migration
- [x] Models in `prisma/schema.prisma` exactly as `database_schema.md`, minus Phase 2 columns; add `IdentityLoginThrottle` and document it in `database_schema.md` 3.1
- [x] `npm run db:migrate:dev -- --name identity_users_sessions_audit`, with raw SQL: unique index on `lower("email")`, `CHECK` on `"phoneE164"`, append-only trigger on `audit_events` (UPDATE and DELETE raise)
- [x] `db:test:migrate` applies cleanly; `db:migrate:check` passes (raw SQL not reported as drift)
- [x] `npm run db:generate`; `resetDatabase()` still clears every new table (the audit trigger allows TRUNCATE)

#### Step 2: RED tests (write first, watch them fail)
- [x] Integration: the four tables exist with `timestamptz(3)` instants; a second user with the same email in different case is rejected; an invalid phone is rejected
- [x] Integration: updating or deleting an `audit_events` row raises; inserting works
- [x] Integration: deleting a role still held by a user is refused (`Restrict`); deleting a user deletes their sessions (`Cascade`)
- [x] Unit: enum parity, `IDENTITY_USER_STATUSES` equals Prisma's `IdentityUserStatus`

#### Step 3: GREEN implementation
- [x] Schema, migration, `identity.types.ts` constants, enum parity test, `database_schema.md` and `prisma/CONVENTIONS.md` updated

#### Step 4: Verification chain
- [x] `lint` · `typecheck` · `build` · `build:worker` · `test:unit` · `test:integration` · `test:e2e` · `db:migrate:check`
- [x] `current_state.md` updated

> **Done 2026-10-30.** Migration `identity_users_sessions_audit` with the case-insensitive email index, the E.164 phone check and the append-only audit trigger (TRUNCATE, used only by the test reset, is still allowed). Drift check clean, and a probe `migrate dev` produced an empty migration (Prisma would not drop the raw SQL). 7 new tests (6 integration, 1 enum parity); the Phase 0 migrations test now lists the new tables. 231 unit, 63 integration, 6 E2E passing.

---

### W-102: Passwords

**Goal:** Passwords are hashed with argon2id and checked in constant time; one strength rule is used by the seed, user creation and later password changes.

**Why now / dependencies:** W-101. Needed by sign-in (W-105), users (W-104) and seeds (W-108).

**Permissions and roles:** None (library code).

**Data and time:** `identity_users.passwordHash` (never returned by any API or written to any log).

**Errors the user can see:** `VALIDATION_FAILED` with a friendly field message for a weak password.

**Module boundaries:** `identity` module (`identity.passwords.ts`); the strength rule moves from `prisma/seeds/realSeed.ts` into it, and the seed imports it from the identity public API.

**Jobs, live updates, adapters:** None.

#### Step 2: RED tests
- [ ] Unit: hash then verify succeeds; a wrong password fails; two hashes of the same password differ (salt); the hash string starts with `$argon2id$`
- [ ] Unit: verifying against a malformed hash returns false, never throws a library error to the caller
- [ ] Unit: the strength rule (12+ characters, three character classes, no placeholder or common word) gives the same results as the Decision 40 seed tests, which keep passing unchanged
- [ ] Unit: a dummy hash is verified when the user does not exist, so timing does not reveal accounts

#### Step 3: GREEN implementation
- [ ] Add `@node-rs/argon2` (pinned); `hashPassword`, `verifyPassword`, `checkPasswordStrength`; the seed uses the shared rule
- [ ] Confirm the production `runner` image loads the native binding (build and health check in the image)

#### Step 4: Verification chain
- [ ] Full chain; `docker:prod:build` succeeds and the app container is healthy
- [ ] `current_state.md` updated

---

### W-103: Audit trail writer

**Goal:** Any module can record who did what to which record; the trail cannot be edited.

**Why now / dependencies:** W-101. User changes (W-104) and sign-in events (W-105) are audited from the start (Decision 23).

**Permissions and roles:** None to write (called by services). Reading the trail (`audit:view`) arrives with the audit views in Phase 10.

**Data and time:** `audit_events` (`occurredAt` from the injected `Clock`); `metadata` holds IDs, never names, emails or phone numbers.

**Errors the user can see:** None (an audit write failure fails the surrounding transaction with `INTERNAL_ERROR`).

**Module boundaries:** New `audit` module with a repository and service; public API `recordAudit()`, which accepts a Prisma transaction so the audit row commits or rolls back with the change it describes.

**Jobs, live updates, adapters:** None.

#### Step 2: RED tests
- [ ] Unit: `recordAudit` requires an action, entity type, entity ID and summary; refuses metadata values that look like an email or phone number
- [ ] Integration: written inside a transaction that rolls back, the audit row is gone too; committed, it is stored with `actorUserId`, `actorRoleCode` and `requestId`
- [ ] Integration: a system action (no actor) stores `actorUserId = null`

#### Step 3: GREEN implementation
- [ ] `src/modules/audit/` (repository, service, types, `index.ts`); action names registry `AUDIT_ACTIONS` (`auth.signed_in`, `auth.signed_out`, `auth.sign_in_failed`, `auth.locked`, `user.created`, `user.updated`, `user.role_changed`, `user.deactivated`, `user.reactivated`)

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-104: Users and the Super Admin protections

**Goal:** Users can be created, edited, given a role, deactivated and reactivated through the service and a guarded API, with every Decision 23 protection enforced and every change audited.

**Why now / dependencies:** W-101 to W-103. The user management screens arrive in Phase 2; this item gives them their API.

**Permissions and roles:** New registry codes `users:view`, `users:create`, `users:edit`, `users:deactivate` (defaults per `project_data.md` 5.4: ADMIN all four, MANAGER `users:view`, AGENT none). The reserved `users:manage-super-admins` guards anything touching a Super Admin. Super Admin passes through the bypass.

**Data and time:** `identity_users` (email stored lowercase; `deactivatedAt` instant). Users are never hard-deleted.

**Errors the user can see:** `VALIDATION_FAILED` (bad email, weak password), `CONFLICT` (email taken; deactivating, demoting or deleting the last active Super Admin), `FORBIDDEN` (an Admin touching a Super Admin or handing out `SUPER_ADMIN`), `NOT_FOUND`.

**Module boundaries:** `identity` owns it. Calls `audit` through its public API inside the same transaction.

**Jobs, live updates, adapters:** Deactivation revokes the user's sessions in the same transaction. No jobs.

#### Step 2: RED tests
- [ ] Unit (service, mocked repository): create normalises the email to lowercase and hashes the password; a taken email gives `CONFLICT`
- [ ] Unit: an Admin cannot create, edit, deactivate or change the role of a Super Admin, nor give anyone the `SUPER_ADMIN` role (`FORBIDDEN`, the code only in the log); a Super Admin can
- [ ] Unit: deactivating, demoting or changing the role of the last **active** Super Admin gives `CONFLICT`; with two it succeeds
- [ ] Integration: `POST /api/users`, `GET /api/users`, `GET /api/users/:id`, `PATCH /api/users/:id`, `POST /api/users/:id/deactivate`, `POST /api/users/:id/reactivate`: success, validation, 401, 403 (no permission code in the body), 404, and the Super Admin bypass for each
- [ ] Integration: each change writes the matching audit event in the same transaction; a refused change writes none
- [ ] Integration: deactivating a user revokes their sessions; their next request is 401
- [ ] Integration: there is no route or service method that hard-deletes a user

#### Step 3: GREEN implementation
- [ ] Registry codes and default bundles; `db:sync-rbac` grants the new codes to ADMIN and MANAGER (Decision 23 rule 1)
- [ ] `identity.repository.ts` user queries, `identity.service.ts` user rules, `identity.schemas.ts` with friendly messages, controller, route adapters under `src/app/api/users/`
- [ ] Responses never include `passwordHash`, `failedLoginCount` or `lockedUntil`

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-105: Sign-in, sign-out and the session cookie

**Goal:** A person signs in with email and password and gets a session cookie; sign-out ends it; wrong passwords lock the account and fast attempts are throttled.

**Why now / dependencies:** W-102 to W-104.

**Permissions and roles:** `POST /api/auth/sign-in` is `'public'` (added to `publicRoutes.ts`, with this decision as its log entry); `POST /api/auth/sign-out` and `GET /api/auth/me` are `'authenticated'`.

**Data and time:** `identity_sessions` (`expiresAt` = min(last activity + 12 h, sign-in + 7 days)); `identity_users.failedLoginCount`, `lockedUntil` (now + 15 min after the 5th failure), `lastLoginAt`; `identity_login_throttle` (20 attempts per hashed IP per 15-minute window). All instants from the injected `Clock`.

**Errors the user can see:** New catalog code `INVALID_CREDENTIALS` (401, "That email and password don't match. Please try again.") for a wrong email, a wrong password, an inactive account or an unknown user, all alike; `RATE_LIMITED` for a locked account or a throttled IP; `VALIDATION_FAILED` for a missing field; `FORBIDDEN` for a cross-site POST.

**Module boundaries:** `identity` owns it; audits through `audit`.

**Jobs, live updates, adapters:** None here (clean-up in W-110).

#### Step 2: RED tests
- [ ] Unit (frozen clock): 4 wrong passwords then a right one signs in and resets the count; the 5th wrong one locks for exactly 15 minutes; a right password during the lock still gives `RATE_LIMITED`; at 15 minutes it works again
- [ ] Unit: the per-IP window allows 20 attempts and refuses the 21st until the window passes; the IP is stored only as a hash
- [ ] Unit: the session token is 32 random bytes; only its SHA-256 hash is stored; expiry follows the 12 h / 7 day rule
- [ ] Integration: correct credentials → 200 with `Set-Cookie: eh_session=…; HttpOnly; SameSite=Lax; Path=/` (and `Secure` when `APP_ENV=production`) and the user's public profile; the token does not appear in the body or the logs
- [ ] Integration: wrong password, unknown email and a deactivated user each return the same `INVALID_CREDENTIALS` body
- [ ] Integration: sign-out revokes the session (the same cookie then gives 401) and clears the cookie
- [ ] Integration: a POST with a session cookie and a foreign `Origin` is refused with `FORBIDDEN`; the same POST from `APP_URL` passes
- [ ] Integration: sign-in, failed sign-in and lockout write audit events (failed ones with no personal data in metadata)

#### Step 3: GREEN implementation
- [ ] Catalog entry `INVALID_CREDENTIALS` (catalog scan test stays green); session, throttle and sign-in services; `route()` Origin check for cookie-authenticated writes; route adapters under `src/app/api/auth/`

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-106: Session-based principal resolver

**Goal:** Every request is resolved from the session cookie to the user's principal, so access checks use real users; activity extends the session.

**Why now / dependencies:** W-105. Replaces the Phase 0 "nobody" resolver.

**Permissions and roles:** All existing guarded routes now work with real sessions. The Super Admin bypass comes from the user's role.

**Data and time:** Reads `identity_sessions` and the user with role and grants on each request; extends `expiresAt` and `lastSeenAt` at most once every 5 minutes.

**Errors the user can see:** `UNAUTHENTICATED` for a missing, expired, revoked or unknown session, or an inactive user.

**Module boundaries:** `identity` builds the principal; `src/instrumentation.ts` installs the resolver for every environment, with the test-only role cookie still layered on top when `APP_ENV=test`.

**Jobs, live updates, adapters:** The live-update stream (W-013) uses the same resolver.

#### Step 2: RED tests
- [ ] Unit (frozen clock): a session idle for 11 h 59 min is valid and is extended; at 12 h it is expired; past 7 days since sign-in it is expired however active; the extension writes at most once per 5 minutes
- [ ] Integration: a valid cookie resolves to the user's principal (role code, bypass flag, permissions from the role's current grants)
- [ ] Integration: removing a permission from the user's role takes effect on the very next request (Decision 4)
- [ ] Integration: an expired, revoked or tampered cookie, or a deactivated user, gives 401 on a guarded route
- [ ] Unit: the test-only role cookie is still refused outside `APP_ENV=test`

#### Step 3: GREEN implementation
- [ ] `createSessionPrincipalResolver()` in `identity`, installed by `instrumentation.ts`; composed with the test cookie resolver in tests

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-107: Sign-in page and the signed-in shell

**Goal:** A person can sign in and out in the browser, sees who they are signed in as, and is sent to sign in when they open a page that needs it.

**Why now / dependencies:** W-105, W-106.

**Permissions and roles:** `/sign-in` is public; other pages show their content only to a signed-in user with the right permission.

**Data and time:** None new. Times shown through `src/shared/time`.

**Errors the user can see:** The friendly catalog messages from the sign-in API (`INVALID_CREDENTIALS`, `RATE_LIMITED`, `VALIDATION_FAILED` field messages); the network error sentence.

**Module boundaries:** `identity/ui/` sign-in form and user menu; `src/app/sign-in/page.tsx`; the app layout shows the shell. UI uses only the shared API client.

**Jobs, live updates, adapters:** None.

#### Step 2: RED tests
- [ ] Unit (component): the form shows field messages, the friendly error, disables the button while submitting, and never shows the server's raw text
- [ ] Unit (component): the shell shows the user's name and a sign-out button; signed out, it shows a "Sign in" link
- [ ] Unit: the `?next=` return path accepts only same-site relative paths (no open redirect)

#### Step 3: GREEN implementation
- [ ] Sign-in page, user menu with sign-out, `PrincipalProvider` fed from `GET /api/auth/me` so `usePrincipal().can()` reflects the real user, "Please sign in" pages link to `/sign-in?next=…`
- [ ] Manual browser check: sign in, see the name, open diagnostics as Admin, sign out, keyboard-only use, narrow screen

#### Step 4: Verification chain
- [ ] Full chain including E2E; manual browser check done; `current_state.md` updated

---

### W-108: Seeds with users

**Goal:** The test database has the fake users of `database_schema.md` Section 10, and the private real seed creates the first Super Admin.

**Why now / dependencies:** W-102, W-104.

**Permissions and roles:** Test users: one `SUPER_ADMIN`, one `ADMIN`, one `MANAGER`, five `AGENT`s, one deactivated agent; one custom role with a small bundle (for Phase 2).

**Data and time:** `identity_users`, `identity_roles`. Credentials only from `.env.test` (`TEST_*`) and `.env` (`SEED_SUPER_ADMIN_*`).

**Errors the user can see:** None (seed scripts print clear errors and refuse wrong targets, as in W-009).

**Module boundaries:** Seeds use the `identity` public API (the same service rules as the app).

**Jobs, live updates, adapters:** None.

#### Step 2: RED tests
- [ ] Integration: the test seed run twice gives identical users (idempotent); each `TEST_*` user can sign in with its `.env.test` password
- [ ] Integration: the real seed creates one active Super Admin from `SEED_SUPER_ADMIN_*` and does nothing if an active Super Admin exists; it still refuses a test database and a weak password (W-009 tests stay green)
- [ ] Scan: committed seed files still contain no password literals

#### Step 3: GREEN implementation
- [ ] `prisma/seeds/testSeed.ts` users; `prisma/seeds/realSeed.ts` creates the first Super Admin; `local_setup.md` Section 2 step 4 no longer says "skip in Phase 0"

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-109: RBAC end to end with real sessions (critical journey 1)

**Goal:** Prove, with real sign-ins, that each role reaches exactly what it should, and that the Super Admin reaches everything.

**Why now / dependencies:** W-104 to W-108.

**Permissions and roles:** Every registered code and every guarded route.

**Data and time:** Uses the seeded test users.

**Errors the user can see:** `UNAUTHENTICATED`, `FORBIDDEN` with the friendly messages.

**Module boundaries:** Tests only.

**Jobs, live updates, adapters:** The live-update stream is part of the matrix.

#### Step 2: RED tests
- [ ] Integration: a table-driven matrix signs in as each seeded role and calls every guarded API route; each result matches the role's grants (allowed → not 401/403; refused → 403 with no permission code), signed out → 401, and `SUPER_ADMIN` passes everything through the bypass
- [ ] Integration: a guard-matrix scan fails if a new guarded route is not in the matrix
- [ ] E2E (journey 1): sign in through the form as `SUPER_ADMIN`, `ADMIN`, `MANAGER` and `AGENT`; each sees their name and only the pages they may use; diagnostics is shown to Super Admin and Admin and refused with the friendly message to Manager and Agent; sign out returns to the sign-in page
- [ ] E2E: the existing specs move from the test-only role cookie to real sign-in where it matters

#### Step 3: GREEN implementation
- [ ] Shared E2E sign-in helper using the seeded credentials from `.env.test`

#### Step 4: Verification chain
- [ ] Full chain including E2E; `current_state.md` updated

---

### W-110: Session and throttle clean-up job

**Goal:** Expired and revoked sessions and old throttle counters are removed every day, so the tables stay small and IP data is not kept longer than needed.

**Why now / dependencies:** W-105; the job foundation (W-012).

**Permissions and roles:** None (worker job).

**Data and time:** Deletes sessions that expired or were revoked more than 7 days ago, and throttle rows whose window ended more than 1 day ago. Runs daily at 03:30 business time (`Asia/Kolkata`).

**Errors the user can see:** None.

**Module boundaries:** `identity.jobs.ts` (`identity.cleanupSessions`), registered in the worker.

**Jobs, live updates, adapters:** One recurring job; idempotent.

#### Step 2: RED tests
- [ ] Unit: the cut-off times are computed from the injected clock
- [ ] Integration (pg-boss `TestClock`): the job deletes only what is past the cut-off; running it twice changes nothing more; the schedule uses the business timezone

#### Step 3: GREEN implementation
- [ ] Job, schedule registration in the worker, `identity` exports it from `index.ts`

#### Step 4: Verification chain
- [ ] Full chain; `current_state.md` updated

---

### W-111: Phase 1 acceptance

**Goal:** Confirm Phase 1 works for a new developer and that the docs match what was built.

- [ ] Fresh clone: `local_setup.md` Section 2 including the real seed (step 4); sign in as the seeded Super Admin in the browser; diagnostics shows the worker `up`
- [ ] `npm run ci:quality` green; GitHub pipeline green; dev database untouched by tests
- [ ] `project_data.md`, `database_schema.md`, `local_setup.md` and `decision_log.md` match what was built
- [ ] Phase 1 set to **DONE** in the Progress Summary, Phase 2 set to **PENDING (next)**

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
