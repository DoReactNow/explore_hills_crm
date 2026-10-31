# Architecture & Design Decisions Log

This document records every significant design decision, its rationale and its trade-offs for the Explore Hills CRM. Every architectural deviation or non-obvious choice must be logged here **before** implementation begins. If a proposal contradicts a logged decision, flag it and ask first.

**Statuses:** Accepted, Amended, Superseded, Resolved, Open (decision still pending, with the phase that needs it).

**Amendments:** when a later decision changes an earlier one, the earlier entry keeps its history and its status line names the newer decision. Where an older bullet would mislead, it is rewritten in place and marked *(amended 2026-10-29)*. Always follow the newest decision.

**Change summary 2026-10-29:** single-company deployment (Decision 21 resolved); cross-module foreign keys allowed (22, supersedes 3); Super Admin and a Roles & Permissions page (23); browser calling through a provider-agnostic telephony layer (24); recordings copied and compressed into our own storage (25); swappable file storage (26); background jobs (27); live updates (28); testing and infrastructure scope adjustments (29); open: calling provider (30) and storage target (31).

---

### Decision 1: Modular Monolith

**Date:** 2026-10-28
**Status:** Accepted

#### Context
The product will grow (WhatsApp, assignment, telephony, reporting, more verticals) and may later need to scale parts independently. Starting with microservices would add network, deployment and consistency complexity before the product is proven.

#### Decision
Build **one deployable application** split into **modules** (`src/modules/<module>/`) with enforced boundaries. Each module owns its controller, service, repository, schemas, events, UI and tests, and exposes a single public entry point (`index.ts`).

Boundaries are enforced by `dependency-cruiser` (`npm run lint:arch`), which runs as part of `npm run lint` and therefore in CI. See `project_data.md` Section 4.2 for the exact rules.

#### Consequences
- One repo, one deploy, one database, fast local development.
- Extracting a module later means moving its folder, swapping its in-process calls and events for network calls and a broker, dropping its cross-module foreign keys (allowed since Decision 22), and giving it its own database. No other module needs to change if it only used the public API. *(amended 2026-10-29)*
- Boundary violations fail CI instead of relying on code review.

---

### Decision 2: Controller / Service / Repository Layering Inside Every Module

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
Request path: `Frontend ↔ API route ↔ Controller ↔ Service ↔ Repository ↔ Database`.

- **`route.ts`** is a thin adapter: `export const POST = route({ access, handler: controller.fn })`. No logic.
- **Controller:** access declaration, Zod parsing, calling the service, response shaping.
- **Service:** business rules, scoping, transactions, events. No HTTP types.
- **Repository:** Prisma queries for the module's own tables. No business rules.
- Prisma is importable only from repositories, seeds, scripts and `shared/db`.

#### Consequences
- Services are unit-testable with a mocked repository; repositories and routes are integration-testable against a real test database.
- A new feature touches each layer once, in isolation.

---

### Decision 3: Cross-Module Communication and No Cross-Module Database Relations

**Date:** 2026-10-28
**Status:** Superseded by Decision 22 (2026-10-29). Kept for history. The communication rule (public APIs and events) carries over into Decision 22; the ban on cross-module foreign keys does not.

#### Context
A module can only be extracted cleanly if it does not depend on another module's tables.

#### Decision
- Modules call each other through public service APIs (synchronous) or through typed events on an in-process event bus (asynchronous).
- A repository queries **only its own module's tables**.
- References to another module's records are stored as **plain ID columns**, not Prisma `@relation`s. Database foreign keys exist only between tables of the same module.
- Cross-module integrity (for example "this `assignedAgentId` is a real user") is enforced in the service layer and covered by integration tests.

#### Consequences
- **Gain:** modules can be split into separate databases later without untangling foreign keys.
- **Cost:** less database-level protection against orphaned IDs, and no single SQL join across modules (use the other module's API or a read model).
- **Revisit trigger:** if integrity bugs appear in practice, allow FKs toward the `identity` module only, as an explicitly logged shared-kernel exception.

---

### Decision 4: RBAC Model (Role-Based Access Control)

**Date:** 2026-10-28
**Status:** Accepted, amended by Decision 23 (2026-10-29)

#### Decision
- A **permission** is one yes/no right covering one action, named `resource:action`.
- A **role** is a named bundle of permissions, stored in the database. System roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `AGENT`. Custom roles are created on the Roles & Permissions page (Decision 23). *(amended 2026-10-29)*
- The **principal** ("identity card") carries the user, role and resolved permission set. It is built **server-side on every request**, so permission changes apply immediately. It is not frozen into a long-lived token.
- A **guard** sits in front of every action and defaults to **deny**. The only exception is a principal whose role bypasses access (`SUPER_ADMIN`, Decision 23). *(amended 2026-10-29)*
- All permission codes live in one registry file, `src/shared/rbac/permissionRegistry.ts`. The guard only accepts registered codes (compile-time check).
- Every `route()` must declare its access (`{ permission }`, `{ anyOf }`, `'authenticated'` or `'public'`). A test scans all `route.ts` files; an undeclared route fails the build.
- Public routes are an explicit allow-list (`src/shared/rbac/publicRoutes.ts`).
- Own/team/all **data scope** is applied by the service layer after the guard passes.
- Default role bundles are defined in code (`defaultRoles.ts`) and applied by an idempotent `db:sync-rbac` command. This command contains no secrets and runs in every environment. Because grants can now be edited in the app, the sync seeds defaults but never overwrites edited grants (exact rules in Decision 23). *(amended 2026-10-29)*

#### Consequences
- Adding a feature means adding a permission to the registry, a guard on the route, and a scope rule in the service.
- Phase 0 builds the guard mechanics and proves them with a protected diagnostics route. Real login-based RBAC acceptance happens in Phase 1.

---

### Decision 5: Permission Names Are Never Shown to Users

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
- Denied actions return the catalog message for `FORBIDDEN` ("You don't have access to do this."). The response body never contains the permission code.
- The permission code and principal ID are written to the **server log** with the `requestId`.
- The frontend may receive the principal's permission list to hide or disable controls, but it never prints permission codes in any message, toast, dialog or error page.
- Tests enforce this at two levels: the error catalog contains no permission-shaped strings; integration tests assert `403` bodies contain no registered code. (The separate E2E page-text check was dropped by Decision 29.) *(amended 2026-10-29)*
- The Roles & Permissions page (Super Admin only, Decision 23) shows each permission by its human-readable label and description, grouped by module. That page is the only place a permission code may appear, as small secondary text for the Super Admin. *(added 2026-10-29)*

---

### Decision 6: Time and Date Handling (UTC Storage, Business-Timezone Logic)

**Date:** 2026-10-28
**Status:** Accepted

#### Context
Storing UTC is correct, but wrong-day bugs appear near midnight when code converts dates using the server's or browser's local timezone, or groups by the UTC day.

#### Decision
1. **Instants** (moments in time) → `timestamptz` (`@db.Timestamptz(3)`), UTC in storage and API.
2. **Business dates** (calendar days) → `date` (`@db.Date`), handled as `YYYY-MM-DD` strings, never through a local-time JS `Date`.
3. One **business timezone** (IANA name) in `APP_CONFIG.locale.businessTimezone`.
4. All date logic lives in `src/shared/time/` (wrapping Luxon). ESLint bans `new Date()`, `Date.now()`, local-time getters and `toLocale*` methods everywhere else.
5. Time is injected through a `Clock`, so tests can freeze it around midnight.
6. "Today/overdue/daily bucket" logic uses the business-day range or `AT TIME ZONE <business tz>`.
7. Postgres runs with `timezone = UTC` in all environments.
8. Time-module unit tests run under several `TZ` values to prove machine-independence.

#### Consequences
- A message arriving at 2026-12-31T18:35Z is correctly "1 January 2027" for an `Asia/Kolkata` business, in reports, filters and the UI alike.
- Slightly more ceremony for date handling, in exchange for removing a whole class of bugs.
- The platform is single-company (Decision 21), so the business timezone stays in `APP_CONFIG`. *(amended 2026-10-29)*

---

### Decision 7: Single Source of Truth for Shared Values

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
Values that must be identical everywhere (product name, company name, support email and phone, locale, business timezone, currency) are defined once in `src/shared/config/appConfig.ts`. Phone numbers are stored in E.164; display and `tel:` forms are derived. Permission codes, role bundles, error messages and date formats each have their own single registry (table in `project_data.md` Section 7).

A unit test scans `src/` for email and phone literals and the product/company names outside `appConfig.ts` and fails on any match. Documentation points to `APP_CONFIG` rather than copying values.

---

### Decision 8: Friendly Errors on the Frontend

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
- Servers return `{ error: { code, message, fieldErrors?, requestId } }`, with `message` taken only from the error catalog.
- The frontend client maps every failure (network, 401, 403, 404, 429, 5xx, unknown) to a fixed friendly sentence. It never displays a raw `Error.message` from a response, a thrown exception or a library.
- Unknown backend errors become `INTERNAL_ERROR` with a generic message; the full error and stack go to the server log with the same `requestId`.
- The `requestId` is shown as "Reference: …" so a user can quote it to support. It is opaque and reveals nothing about the backend.
- Global `error.tsx`, `global-error.tsx` and `not-found.tsx` follow the same rule.
- Tests: unit tests on the mapper and catalog; integration tests assert error bodies (including that a `403` body contains no permission code); an E2E test triggers 403, 404 and 500 and asserts the page text contains no stack, SQL, library name or `ECONNREFUSED`-style strings. *(amended 2026-10-29: the permission-code page check moved to the integration tests, Decision 29)*

---

### Decision 9: Three-Tier Test Strategy

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
- **Unit** (Vitest): pure logic, no database. Files named `*.unit.test.ts(x)`.
- **Integration** (Vitest, node environment): route handler through to a **real** Postgres test database. Files named `*.int.test.ts`. Prisma is never mocked here. Files run serially because they share one database.
- **E2E** (Playwright): real browser against the **built** app (`next start`) with `.env.test`. Files named `*.e2e.ts` in `e2e/`.
- Individually runnable commands: `test:unit`, `test:integration`, `test:e2e`, plus `test` (all three) and `ci:quality`.
- Integration and E2E commands prepare the test database themselves (migrate, RBAC sync, test seed), so each is runnable on its own.
- Unit tests for the time module run under a `TZ` matrix.
- E2E covers only the critical journeys listed in Decision 29; everything else is covered by unit and integration tests. *(added 2026-10-29)*
- Background-job handlers and provider/storage adapters have their own test rules (Decisions 24, 26, 27). *(added 2026-10-29)*

---

### Decision 10: Environment Files, Isolated Test Environment, IPv4 Literals, Uncommon Ports

**Date:** 2026-10-28
**Status:** Accepted, amended by Decision 29 (2026-10-29)

#### Decision
- `.env` (dev), `.env.test` (tests), `.env.production` (production). All real env files are git-ignored; `.env.example`, `.env.test.example` and `.env.production.example` are committed with safe default values so a developer can copy them and go.
- Tests load `.env.test` with override, so test runs can never read the dev database.
- Startup and test setup **refuse** to run if `APP_ENV=test` and the database name does not end in `_test` (and the reverse for production).
- URLs use `127.0.0.1`, never `localhost`.
- Web ports are uncommon: dev `47213`, Docker app `47214`, E2E `47215`. The ports are defined once (`APP_PORT` in the env files) and read by `scripts/run-next.mjs`, Playwright and Docker.
- The local Postgres host port is `54329` instead of `5432`, to avoid colliding with a Postgres already installed on the developer's machine.
- Inside Docker networks, containers reach each other by **service name** (Docker's built-in DNS). Fixed container IP addresses were dropped by Decision 29. *(amended 2026-10-29)*

---

### Decision 11: Seed Separation (Test Seed vs Private Real Seed vs RBAC Sync)

**Date:** 2026-10-28
**Status:** Accepted

#### Context
A committed seed file with real credentials is a security hole. A test seed that can run against a real database is a data hazard.

#### Decision
Three separate things:

| What | File | Committed? | Command | Contains |
|:---|:---|:---|:---|:---|
| **RBAC sync** (permissions, system roles, default bundles) | `src/modules/identity/rbac/syncRbac.ts`, driven by the registry and `defaultRoles.ts` | Yes | `npm run db:sync-rbac` | No secrets. Safe everywhere. |
| **Test seed** | `prisma/seed-test.ts` | Yes | `npm run db:seed:test` | Fake users whose credentials come from `.env.test` variables, so the file itself holds no passwords. Refuses any database not ending in `_test`. |
| **Real seed** (first admin, real team) | `prisma/private/seed.ts` | **No. The whole `prisma/private/` folder is git-ignored.** | `npm run db:seed` | Real values read from `.env`. Refuses a `_test` database. |

- A committed template, `prisma/seed.example.ts`, shows the real seed's structure with placeholders only. A developer copies it into `prisma/private/seed.ts`.
- Prisma's automatic seed-on-reset hook is **not** configured, so `migrate reset` can never run a seed by accident.
- CI has a guard script that fails if any file under `prisma/private/` or any real `.env*` file is tracked by git.

#### Consequences
- Production gets its admin through an operator running `db:seed` once with the private file; it never travels through the repository.
- Test credentials are throwaway values, valid only in the test database.

---

### Decision 12: Database Migrations With Prisma, Applied Automatically in CI and CD

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
- Every schema change is a **named Prisma migration** committed to `prisma/migrations/`. Applied migrations are never edited.
- Developers use `npm run db:migrate:dev -- --name <snake_case_name>`; every other environment uses `migrate deploy`.
- **CI** applies migrations to the CI test database in a dedicated step (`db:test:migrate`) and runs a **drift check** (`db:migrate:check`) that fails if `schema.prisma` has changes without a migration.
- **CD** applies migrations to production **before** the new application version starts, using a one-shot migrator container. If migration fails, the rollout stops.
- **Expand/contract policy:** migrations must be backward compatible with the previous app version (add columns as nullable or with defaults, drop or rename only after a release that no longer uses them), so deploys do not need downtime.

---

### Decision 13: CI Pipeline With Individual Steps, Build Before Tests

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
GitHub Actions `ci.yml` runs separate jobs: `lint`, `typecheck` (parallel) → `build` → `test-unit`, `test-integration`, `test-e2e` (parallel, each `needs: build`). Each job calls its **own** npm script. The pipeline does **not** call `ci:quality`.

- The `build` job uploads the `.next` output; the E2E job downloads and runs that exact build.
- Integration and E2E jobs each start their own Postgres service on port `54329` and use `.env.test` created from `.env.test.example`, so the same URLs work locally and in CI.
- Node version comes from `.nvmrc`.
- `npm run ci:quality` exists for local parity: it runs `lint → typecheck → build → build:worker → test:unit → test:integration → test:e2e` sequentially and stops at the first failure. *(amended 2026-10-29: worker build added)*
- The `build` job uploads `.next` with `include-hidden-files: true` (upload-artifact v4 skips hidden folders by default). *(added 2026-10-29)*

---

### Decision 14: Separate Local and Production Docker Setups

**Date:** 2026-10-28
**Status:** Accepted, amended 2026-10-29 (worker service from Decision 27, no fixed IPs per Decision 29)

#### Decision
| | Local | Production |
|:---|:---|:---|
| Files | `docker/Dockerfile.local`, `docker/docker-compose.local.yml` | `docker/Dockerfile.prod`, `docker/docker-compose.prod.yml` |
| Purpose | Postgres (dev and test DBs) always; the app and worker containers are optional via the `app` profile, with hot reload | Hardened runtime image; migrations as a separate one-shot service; a long-running `worker` service for background jobs (Decision 27) |
| Database | Local Postgres container | Managed database via `DATABASE_URL` |
| Image | Full dev dependencies, source mounted | Multi-stage build, Next.js `standalone` output, non-root user, healthcheck, read-only filesystem |
| Migrations | Run by the developer | `migrate` service runs `prisma migrate deploy`; `app` and `worker` start only after it completes successfully |
| File storage | Local folder (`STORAGE_DRIVER=local`); an optional local S3-compatible container for adapter tests | Chosen by Decision 31 (S3-compatible cloud, self-hosted S3 on the VPS, or a local disk volume with off-server backups) |

Local uses a dedicated Docker network and production uses Compose's default network; in both, containers reach each other by service name, and Postgres runs with `timezone=UTC`. *(amended 2026-10-29)*

---

### Decision 15: Git Ignore Policy

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
Ignore everything that can be regenerated or is secret: `node_modules/`, `.next/`, build output, coverage, test results and Playwright reports, generated Prisma client output, logs, OS and editor files, all `.env*` except the three `*.example` files, the entire `prisma/private/` folder, and the local file-storage folder `storage/` (recordings and uploads written by the `local` storage driver, Decision 26). *(amended 2026-10-29)* The committed `.gitignore` is the single definition; CI's forbidden-files guard verifies nothing ignored has been force-added.

---

### Decision 16: One Local Postgres Container With Two Databases

**Date:** 2026-10-28
**Status:** Accepted

#### Decision
One container (`explorehills_local_db`) hosts `explorehills_dev` and `explorehills_test`. The test database is created by an init script on first start; direct commands to create either database are in `local_setup.md` for volumes that already exist. Tests are isolated by database, credentials in `.env.test`, and the safety guards in Decision 10.

#### Trade-off
A second container would isolate even more strongly but doubles the local footprint. The `_test` name guard makes accidental cross-use fail loudly.

---

### Decision 17: Product Scope — Lead Assignment CRM With Third-Party Calling

**Date:** 2026-10-28
**Status:** Accepted, amended by Decision 24 (2026-10-29)

#### Context
The original idea was a call-routing platform on WhatsApp calling. The confirmed product is a CRM where WhatsApp enquiries become leads that a manager distributes, and agents call customers themselves.

#### Decision
- Customers enquire by WhatsApp **message**. Enquiries become leads.
- The manager assigns leads using the modes in `project_data.md` Section 3.3.
- Agents call through the company's **third-party provider**, using a provider-agnostic telephony layer that logs calls back onto the lead.
- Agents talk **from the browser** through the provider's browser-calling kit (WebRTC), as set out in Decision 24. Audio flows between the agent's browser and the provider. The platform itself still carries no audio and runs no media or SIP server. *(amended 2026-10-29)*
- The product is used by **one company, Explore Hills** (Decision 21). *(added 2026-10-29)*

---

### Decision 18: WhatsApp Calling Inside the Platform Is Deferred

**Date:** 2026-10-28
**Status:** Accepted (deferred; revisit in a later phase)

#### Decision
Not built now. When added, there are three routes: buy calling through a WhatsApp provider and log calls via API (cheapest), build a call gateway and media layer (full control, much larger build), or a hybrid. The call adapter is designed so any route plugs in without CRM changes.

---

### Decision 19: WhatsApp Integration Route

**Date:** 2026-10-28 (updated 2026-10-31)
**Status:** Open for go-live only: the owner will use Meta directly or a reseller. Phase 4 is built behind the gateway with the `fake` implementation (Decision 58). The real adapter is needed before production.

Options: direct Meta Cloud API (no platform fee, more integration work) or through a WhatsApp provider (faster start, platform fee and dependency). The messaging module hides the choice behind a `WhatsAppGateway` interface so the decision can change without touching leads or assignment.

---

### Decision 20: Authentication Approach

**Date:** 2026-10-28 (resolved 2026-10-30)
**Status:** Resolved by Decision 46: our own sessions table (not Auth.js), 12-hour sliding sessions capped at 7 days, lock for 15 minutes after 5 wrong passwords.

Candidates: Auth.js with a credentials provider and server-side session lookup, or a custom session table. Constraint from Decision 4: the principal and its permissions are resolved server-side on every request. The Phase 1 plan must also decide password hashing, session lifetime and lockout rules.

---

### Decision 21: Tenancy Model — Single Company

**Date:** 2026-10-28 (resolved 2026-10-29)
**Status:** Resolved

#### Decision
The platform is built for **one company, Explore Hills**. There is no `tenant` table and no `tenantId` column. The business timezone, company name and similar values stay in `APP_CONFIG` (Decision 7).

#### Consequences
- Simpler schema, queries and permission model.
- If the product is ever offered to other companies, multi-tenancy would be a deliberate, larger change: a `tenantId` on every table, tenant-scoped unique constraints, and tenant-scoped settings. It is not prepared for now.

---

### Decision 22: Database Foreign Keys Are Allowed Across Modules

**Date:** 2026-10-29
**Status:** Accepted (supersedes Decision 3)

#### Context
Decision 3 banned foreign keys between tables of different modules, so that any module could later be moved into its own service with its own database. Explore Hills is a single-company CRM (Decision 21), so that split is very unlikely. The ban cost real protection: the database would accept an ID that points to nothing, and the service layer needed extra code and tests to catch it.

#### Decision
- Real foreign keys and Prisma `@relation`s are allowed between any tables, **including across modules** (for example `leads_leads.ownerUserId → identity_users.id`).
- Every cross-module foreign key states its delete behaviour explicitly:
  - `Restrict` is the default. For example, a user who still owns leads cannot be hard-deleted; users are **deactivated** instead.
  - `SetNull` only where losing the link is acceptable, and the reason is written next to the relation in `schema.prisma`.
  - `Cascade` is allowed only **inside** a module, never across modules.
- **Writes:** a repository writes only its own module's tables. Changing another module's data goes through that module's public API or an event.
- **Reads:** a repository may read another module's tables through Prisma relations (`include` / `select`) for display and reporting, for example a lead together with its owner's name. Business rules about that data stay in the owning module.
- Modules still talk to each other only through `index.ts` (public API) or typed events. The folder layout and the `dependency-cruiser` rules stay. Boundary rule 6 in `project_data.md` Section 4.2 is updated to "writes only its own tables".

#### Consequences
- **Gain:** Postgres rejects IDs that point to nothing; one query can load a lead with its owner; less integrity code and fewer tests.
- **Cost:** moving a module into its own service later would first need its cross-module foreign keys dropped, which is a routine migration.
- The service-level "does this user exist" checks from Decision 3 are no longer needed where a foreign key exists. Services still check business conditions (for example "the user is an **active agent**").

---

### Decision 23: Super Admin and the Roles & Permissions Page

**Date:** 2026-10-29
**Status:** Accepted (amends Decision 4)

#### Context
Explore Hills wants a page where roles can be created and their permissions changed, and wants exactly one role that can do everything.

#### Decision
**Roles**
- System roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `AGENT`. Custom roles can be added on the Roles & Permissions page.
- **`SUPER_ADMIN` is the only role that bypasses access checks.** The guard and `assertCan` allow every action, and data scope resolves to "all". This is a flag on the role (`bypassesAccess`), checked in exactly one place (the guard and scope resolver). Feature code never compares role names. The role holds no rows in `identity_role_permissions`.
- **`ADMIN` is a normal role.** Its default bundle is the `ADMIN` column of the permission catalogue in `project_data.md` Section 5.4: every non-reserved permission except agent-only actions such as `leads:claim`. The Super Admin can change it like any other role.

**Reserved permissions (Super Admin only)**
- `roles:manage` (create, edit and delete roles and their permissions) and `users:manage-super-admins` (create, edit, deactivate a Super Admin, or give a user the `SUPER_ADMIN` role) are **reserved**. They are in the registry so routes can declare them, but they can never be granted to any role. Only the bypass reaches them. The service rejects any attempt to add them to a role, and a unit test proves it.
- An Admin with `users:*` permissions can manage other users but never a Super Admin account, and cannot hand out the `SUPER_ADMIN` role.

**Bypass covers access only, not business rules**
- The Super Admin still cannot send a free-form WhatsApp message outside the 24-hour window, claim a blast lead someone else already claimed, skip validation, or break idempotency.
- Every Super Admin action is written to the audit trail like anyone else's.

**Protections**
- The `SUPER_ADMIN` role cannot be edited, renamed or deleted.
- There must always be at least one active Super Admin. Deactivating, deleting or changing the role of the last one fails with `CONFLICT`.
- The first Super Admin is created by the private real seed (Decision 11).

**The Roles & Permissions page (Super Admin only, built in Phase 2)**
- List roles with the number of users holding each.
- Create, rename and delete custom roles. Deleting a role that users still hold fails with `CONFLICT` and a friendly message.
- Edit the permissions of any role except `SUPER_ADMIN`, including `ADMIN`. Permissions are grouped by module and shown with a human-readable label and description (Decision 5).
- "Reset to defaults" for a system role re-applies its bundle from `defaultRoles.ts`.
- Every change is audited: who, which role, which permissions were added and removed.
- Changes take effect on the user's next request, because the principal is built per request (Decision 4).

**How `db:sync-rbac` behaves now that grants are edited in the app**
1. Inserts permissions newly added to the registry, and grants each **new** permission to the roles listed for it in `defaultRoles.ts`.
2. Removes permissions deleted from the registry, together with their grants.
3. Creates any missing system role with its default bundle.
4. Never changes the grants of existing roles otherwise, so edits made on the page survive every deploy.
5. Creates the `SUPER_ADMIN` row only if missing and never updates it (a database trigger blocks changing its code or bypass flag, or deleting it).

#### Consequences
- The earlier "custom roles come later" is replaced: the page is part of Phase 2.
- Audit: the `audit_events` table and its writer arrive in Phase 1, so user and role changes are audited from the start (the audit views stay in Phase 10).
- Required tests: Super Admin bypass (including scope = all); reserved codes cannot be granted; Admin cannot touch a Super Admin; last-Super-Admin protection; the sync keeps edited grants and still grants new permissions by default; a permission change applies on the next request.

---

### Decision 24: Browser Calling (WebRTC) Through a Provider-Agnostic Telephony Layer

**Date:** 2026-10-29
**Status:** Accepted (amends Decision 17; the provider itself is open, Decision 30)

#### Context
Agents should make and receive calls inside the CRM in the browser, with the live call visible on the lead. The calling provider is not chosen yet, because costs are still being compared, so the provider must be replaceable without touching the rest of the CRM.

#### Decision
**How a call works**
- The agent clicks Call on a lead. The CRM creates a call record with our own `callRef`, asks the active provider for the agent's browser credentials, and the browser softphone dials through the provider's WebRTC kit.
- The provider connects the call to the customer's phone, records it if recording is on, and reports progress to our webhook.
- The platform runs no media or SIP server. Audio goes between the agent's browser and the provider.

**Two adapter interfaces, because providers differ on both sides**
- **Server side, `TelephonyProvider`** (telephony module). Each provider implements:
  - `key` and `capabilities`
  - `issueAgentCredentials(agent)`: a short-lived token or login the browser uses to connect
  - `placeCall(request)`: a server-started call, used for click-to-call to the agent's phone as a fallback
  - `verifyWebhook(request)` and `parseWebhook(request)`: return normalised `CallEvent`s
  - `answerInboundRouting(event)`: tells the provider which agent to ring, where the provider supports it
  - `fetchRecording(providerCallId)`: returns the audio as a stream
- **Browser side, `SoftphoneClient`** (telephony UI). Each provider implements:
  - `connect(credentials)`, `dial(callRef, phone)`, `answer()`, `hangup()`, `mute()`, `hold()`, `sendDtmf()`
  - events: `ringing`, `connected`, `ended`, `error`, `connectionLost`
- Each provider lives in one folder, `src/modules/telephony/providers/<key>/`, with `server.ts` and `browser.ts`, and is registered in two registries: `providers/registry.server.ts` (server adapters, marked server-only) and `providers/registry.browser.ts` (browser adapters), so server code never reaches the browser bundle. The active provider is chosen by the `TELEPHONY_PROVIDER` environment value. No code outside that folder knows which provider is in use.

**Capabilities, not provider names**
- Each adapter declares flags: `browserCalling`, `clickToCall`, `inboundRouting`, `recording`, `dualChannelRecording`, `liveStatusEvents`. Services and UI check these flags and never check provider names.
- If browser calling is unavailable, or the agent's connection fails, and the provider supports click-to-call, the UI offers "call via my phone" instead.

**One normalised call lifecycle**
- Every adapter maps provider statuses onto our own `TelephonyCallStatus` values, so the call log, reports and UI never see provider-specific states.

**Plug and play, made testable**
- A **`fake` provider** (server and browser) is used in development and in every test. No test ever calls a real provider.
- A **shared contract test suite** runs against every adapter, using recorded webhook payloads from that provider as fixtures.
- Adding a provider means: a new folder, the contract suite passing, and a new `TELEPHONY_PROVIDER` value. Nothing else in the CRM changes.

**What the agent sees**
- A live call card on the lead (dialling, ringing, connected with a timer, ended). It is driven by the softphone's own events, and confirmed by server events pushed over the live-update channel (Decision 28).
- For inbound calls, where the provider supports routing by webhook: the CRM rings the lead's owner if they are online, otherwise it follows the fallback rule in settings. The agent gets an incoming-call pop-up showing the lead.

**Agent credentials**
- Short-lived tokens are preferred.
- If a provider uses a fixed SIP login per agent, the login is stored encrypted (application-level encryption, key from the environment), is handed to the browser only when the softphone connects, and is never written to logs. Each agent has their own login, because providers such as Exotel allow one active session per login.

**Requirements recorded for rollout**
- HTTPS (needed for microphone access), a headset per agent, the network ports and TURN settings the chosen provider documents.
- Exotel's documentation, for example, lists UDP 10000–60000 plus the SIP signalling port, and TURN details for strict firewalls.

#### Consequences
- Replaces the earlier "no in-platform softphone" scope line.
- Built in Phase 7. The `fake` provider and the contract suite come first, then the first real provider once Decision 30 is made.
- Calling Indian phone numbers from a browser needs the provider to support licensed internet-to-phone-network calling. Exotel calls this "IP-PSTN intermix" and switches it on per account. This must be confirmed for any candidate (Decision 30).

---

### Decision 25: Call Recordings — the Provider Records, We Keep a Compressed Copy

**Date:** 2026-10-29
**Status:** Accepted

#### Context
Recordings are made by the provider, because the audio passes through the provider. Providers keep recordings only for a limited time and their download links expire. Exotel, for example, keeps them for 90 days by default and deletes them permanently afterwards. Audio files must never make the database large.

#### Decision
- Recording is switched on at the provider. Callers hear a "this call is recorded" announcement; the exact wording is confirmed in Phase 10.
- When the provider reports that a recording is ready, a background job (Decision 27) does the following:
  1. Downloads the file while the provider's link is still valid.
  2. Converts it to **mono MP3 at about 24 kbps** with `ffmpeg`, provided by the `ffmpeg-static` package so no system install is needed (override with `FFMPEG_PATH` if required). That is roughly 180 KB per minute, against about 1 MB per minute for WAV. The codec and bitrate are settings.
  3. Saves it through the file-storage interface (Decision 26).
  4. Stores only the metadata on the call: storage key, size, duration, checksum and recording status.
- **The database never stores audio bytes.**
- **Playback:** needs `telephony:view-recordings` plus the normal own/team/all scope. Audio is served through a short-lived link: a signed URL where the storage supports one, otherwise the app streams the file after the permission check. Every playback is audited.
- **Retention:** `retention.recordingDays` (default 180). A scheduled job deletes expired files and clears the key. The call log itself stays.
- **Failures:** the job retries with backoff. If the provider's link has expired, the recording status becomes `FAILED` and managers are alerted. A recording failure never blocks or changes the call log.

#### Consequences
- Recordings outlive the provider's retention and survive a change of provider.
- Rough storage, assuming 10 agents × 30 calls a day × 4 minutes: about 6–7 GB a month at 24 kbps.

---

### Decision 26: File Storage Behind a Swappable Interface

**Date:** 2026-10-29
**Status:** Accepted (the production target is open, Decision 31)

#### Decision
- One interface, `FileStorage`, in `src/shared/storage/`:
  - `put(key, stream, contentType)`, `get(key)`, `delete(key)`, `exists(key)`
  - `getTemporaryUrl(key, ttlSeconds)`, which returns nothing when the driver cannot sign links, in which case the app streams the file itself
- Drivers:

| Driver | Use |
|:---|:---|
| `local` | A folder on the server's disk (`storage/` locally). The default for development and tests. Also valid in production on a single VPS, together with off-server backups. |
| `s3` | Any **S3-compatible** service, set by endpoint, region, bucket and keys. Cloud: AWS S3, Cloudflare R2, Backblaze B2, Wasabi and others. **Self-hosted on our own VPS:** Garage, SeaweedFS or MinIO running in Docker. |
| `gdrive` | Optional, later, only if chosen. Limits: no signed links (the app must stream every playback), API request quotas, and a service account needs a Shared Drive on Google Workspace. Confirm these limits before building it. |

- The driver is chosen by `STORAGE_DRIVER` plus that driver's settings in the environment. **Switching storage is a configuration change, not a code change.**
- Keys are generated by us and never contain personal data, for example `recordings/2026/12/<callId>.mp3`. The same key works on every driver.
- `npm run storage:copy -- --from <driver> --to <driver>` copies every stored file from one driver to another, so a later move (for example local disk → R2) needs no database change.
- A **shared contract test suite** runs against every driver: `local` in the normal test run, and `s3` against a local S3-compatible container in an optional integration suite.
- With `local` storage, or S3 self-hosted on the same VPS: a nightly off-server backup job and a disk-usage alert are required before go-live (Phase 12).

#### Consequences
- Any S3-compatible target, in the cloud or on our own VPS, works without code changes.
- Unknown: the free edition of MinIO changed during 2025. Verify its current state before choosing it; Garage and SeaweedFS are the alternatives.

---

### Decision 27: Background Jobs With pg-boss and a Separate Worker Process

**Date:** 2026-10-29
**Status:** Accepted

#### Context
Several features must run outside a web request: assignment timeouts, blast-pool expiry, SLA and follow-up reminders, recording download and conversion, retention clean-up, webhook processing with retries, and report snapshots.

#### Decision
- **pg-boss**: a job queue that runs on the existing Postgres, so there is no Redis or extra service. It keeps its tables in its own Postgres schema, `pgboss`, which Prisma does not manage and the drift check ignores.
- A **separate worker process** from the same codebase: `npm run worker` locally, a `worker` service in Docker. The web app only adds jobs; the worker runs them. Each can be restarted and scaled on its own.
- Jobs are defined per module in `src/modules/<module>/<module>.jobs.ts`. Each job has a name, a Zod-validated payload, a handler and a retry policy.
  - Each module exports its job definitions from its `index.ts`. `src/shared/jobs/` holds only the mechanism (`defineJob()`, the `JobQueue` interface, the registry type). The worker entry (`src/worker/`) assembles all modules' jobs, because `src/shared` may never import modules.
  - Handlers call the module's service and never touch Prisma directly.
- A `JobQueue` interface (`enqueue`, `enqueueAt`, `schedule`, `cancel`) wraps pg-boss, so the queue technology can be swapped without touching modules.

**Rules for every job**
- **Idempotent:** running the same job twice changes nothing the second time.
- Retries with backoff, and a final failed state that raises an alert.
- Recurring jobs are defined in code, with times in the business timezone. Time comes from the injected `Clock`.
- Timeouts use **delayed jobs** (for example "check lead X at assignedAt + 30 minutes") rather than constant polling, plus a periodic sweeper as a safety net.

**Webhooks**
- The route verifies the signature, stores the raw event in the webhook log, adds a processing job and returns `200` quickly. Processing happens in the worker.

**Testing**
- Unit tests call handlers directly.
- Integration tests run real queues against the test database and use a `runPendingJobs()` helper.
- No test waits on real time; the `Clock` is advanced instead.

**Health**
- The worker writes a heartbeat. Failing or stuck jobs appear on the diagnostics page.

#### Consequences
- Production runs `migrate` (once per deploy), `app` and `worker`.
- Hosting must allow long-running processes, so an always-on container host or VPS rather than serverless functions.
- The job foundation is built in Phase 0; each feature phase adds its own jobs.

---

### Decision 28: Live Updates With Server-Sent Events

**Date:** 2026-10-29
**Status:** Accepted

#### Context
Several screens must change without a page refresh: a blast lead disappears for the other agents once claimed, new leads appear in the manager queue, new WhatsApp messages arrive, the call card updates, incoming calls pop up, and notifications appear.

#### Decision
- **Server-Sent Events (SSE)**: one authenticated endpoint, `GET /api/events/stream`. The browser uses `EventSource`, which reconnects automatically.
- **Events are notices, not data.** An event says what changed and carries IDs (for example `lead.claimed { leadId }`). The browser then re-fetches through the normal API, so permission and scope checks stay in one place.
- Before sending, the server drops any event the user is not allowed to see (same permission and scope rules).
- Each module declares its event types (name, ID-only payload schema, receive filter) in its own `<module>.events.ts` and exports them from `index.ts`. `src/shared/realtime/` holds only the mechanism; the stream route in `src/app/` assembles the modules' event types and filters.
- **Across processes:** the app and the worker publish events through Postgres `LISTEN/NOTIFY`. Every app instance relays them to its connected browsers. Payloads are kept small (Postgres limits a notice to about 8 KB).
- **After a reconnect** the page re-fetches its current state. No event history is replayed.
- **Fallback:** if the stream cannot connect, screens fall back to polling every few seconds.
- The softphone's own connection to the provider is separate and not part of this channel.

#### Consequences
- Requires an always-on Node server (Docker or VPS), not serverless. This is recorded for the hosting choice.
- The SSE endpoint and the event relay are built in Phase 0; features add their event types in their own phases.

---

### Decision 29: Testing and Infrastructure Scope Adjustments

**Date:** 2026-10-29
**Status:** Accepted (amends Decisions 5, 9, 10 and 14)

#### Context
A review on 2026-10-28 found some rules cost more than they return for a single-company CRM that is built mostly with AI coding tools. For AI-written code, tests are the main safety net, so test-first stays where bugs are likely and expensive.

#### Decision
**Test-first stays mandatory for**
- The assignment engine and every mode
- Blast-claim concurrency
- Timeouts and every background job
- Webhook idempotency (WhatsApp and telephony)
- The RBAC guard, Super Admin bypass and data scope
- The time module
- The telephony and storage adapter contract suites

**Plain screens and CRUD** may have tests written alongside the code instead of strictly first. The coverage list in `TDD_INSTRUCTION_GUIDE.md` still applies: success, validation, 401, 403, not found and scope.

**E2E is limited to these 8 critical journeys**
1. Log in as each role.
2. A manager bulk-assigns leads with a preview.
3. An agent claims a blast lead, and a second agent sees it disappear.
4. An agent replies on WhatsApp inside the 24-hour window, and gets template-only sending outside it.
5. An agent makes a browser call with the `fake` provider, and the call log appears on the lead.
6. Recording playback is allowed for a manager and refused for an agent.
7. The Super Admin edits a role on the Roles & Permissions page, and the change applies.
8. The friendly 404, 403 and 500 pages.

**Dropped**
- The E2E test that checked page text for permission codes. The integration body check and the catalog scan remain.
- Fixed container IP addresses in Docker networks. Containers use service names.

**Kept unchanged**, because they are cheap once built: the time-zone test matrix, the SSOT scan, the architecture lint and the CI job structure.

---

### Decision 30: Open — Calling Provider

**Date:** 2026-10-29
**Status:** Open (needed before the first real adapter in Phase 7; the `fake` provider unblocks everything before that)

Costs are being compared. For each candidate, confirm:

- Browser calling (WebRTC) to Indian mobile and landline numbers, under the provider's licence (licensed internet-to-phone-network calling).
- Price per minute for the browser leg and the phone leg, number rental, and any per-agent or platform fee.
- Recording: on/off control, format, retention period, and a download API.
- Webhooks: ringing, answered and ended events; signature verification; recording-ready event.
- Inbound routing decided by our webhook.
- Short-lived browser tokens versus fixed SIP logins, and concurrency limits.
- Compliance:
  - Rules from India's telecom regulators (DoT and TRAI) for business calls to customers who enquired first.
  - Consent and notice for recordings under India's data protection law (the DPDP Act).

Example candidates to evaluate: Exotel (browser SDK confirmed in its documentation), Knowlarity, Ozonetel and Plivo. Global providers may not offer domestic calling within India; verify before shortlisting.

**Update, 2026-10-31:** the owner is still deciding and asked for a suggestion. Suggested: get written quotes from Exotel (first choice) and Knowlarity (price check). Plivo limits Indian routes to India-registered businesses with both call legs and media in India, and whether its browser calling qualifies is unconfirmed. Public prices are mostly third-party estimates, so the quotes must settle them.

---

### Decision 31: Open — Recording Storage Target

**Date:** 2026-10-29
**Status:** Open (needed before production go-live; development and tests use `local`)

Options:
- An S3-compatible cloud service (for example Cloudflare R2).
- A self-hosted S3-compatible server on the VPS (Garage, SeaweedFS, or MinIO after checking its current licence).
- A plain local disk volume on the VPS.
- Google Drive through the optional `gdrive` driver.

The choice must come with a backup plan (Decision 26) and a retention setting (Decision 25).

---

### Decision 32: Repository, Commit Policy and GitHub Remote

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- The project is a git repository with `main` as the default branch, initialised at the start of Phase 0 (before W-001).
- **A commit is made only after the full local check chain for the work item has passed** (the verification chain in `TDD_INSTRUCTION_GUIDE.md` Part 2 Step 4, at minimum the steps that exist at that point). Never commit a red or partially verified state.
- The GitHub remote (`origin`) is added as soon as the user provides the repository URL; W-011 needs it for the real pull request and the green pipeline.

---

### Decision 33: Toolchain Version Pins at Install Time

**Date:** 2026-10-30
**Status:** Accepted

#### Context
On 2026-10-30 npm's `latest` tag for `prisma` points to a release candidate (`8.0.0-rc.28`), and `typescript`'s `latest` is `7.0.2` (the native compiler), which parts of the ecosystem may not support yet.

#### Decision
- Prisma is pinned to the newest **stable 7.x** (`7.10.1` on this date), never an RC, matching W-001 and W-007.
- TypeScript uses the newest major that Next.js 16 type generation and `typescript-eslint` officially support at install time. If TypeScript 7 is not supported by them, use the newest 5.x/6.x line that is. The chosen version is recorded in `package.json` and in the W-001 notes in `current_state.md`.
- Every other tool uses its current stable major (Next.js 16.x and so on).

---

### Decision 34: Phase 0 Documentation Fixes

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Encryption key in the local Docker compose file:** the `app` and `worker` services previously used a value that is not a valid 32-byte base64 key, which the W-002 env validation would reject. They now use the same dev placeholder as `.env.example`. `local_setup.md` Section 4 is updated.
- **E2E specs in W-008 part A:** part A runs before W-003 (health route) and W-004 (not-found page), so their specs could not pass there. Part A now only sets up Playwright; the health spec is written and ticked in W-003 and the not-found spec in W-004. `current_state.md` is updated.
- **Business timezone:** `Asia/Kolkata` is confirmed by the user (no longer an assumption). Company legal name, support email and phone stay placeholders until the first production release.

**Outcome at install (2026-10-30, W-001):** TypeScript **5.9.3** (the Next.js 16.4.3 starter itself declares `typescript ^5`). ESLint stays on **9.39.5**: ESLint 10 installs, but the plugins bundled in `eslint-config-next` 16.4.3 (`import`, `jsx-a11y`, `react`) do not declare ESLint 10 support. npm marks 9.x as no longer supported; move to 10 when `eslint-config-next` supports it. Next's `cacheComponents` (on in the starter) is left off for now; turning it on later is a logged decision.

**Addendum (2026-10-30, W-007):** `dotenv-cli` 11 replaced `dotenv -e <file> -- <cmd>` with `dotenv run -f <file> -- <cmd>`. All scripts use `dotenv run -q --override -f <file> --`: `--override` makes the named env file win over values already in the shell, so a stray `DATABASE_URL` can never send a migration or seed to the wrong database. The drift check (`db:migrate:check`) migrates the test database and diffs it against `schema.prisma`, so no shadow database is needed (details in `database_schema.md` Section 6).

---

### Decision 35: Phase 0 Kernel Choices Made in W-003

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Logger:** a small in-house structured JSON logger (`src/shared/logger/`) instead of a library such as pino. It writes one JSON line per record (warn and above to stderr), takes its level from `LOG_LEVEL`, redacts secret-looking keys at any depth (password, secret, token, authorization, cookie, API key, `*Encrypted`, credentials, database URL), and serialises errors with name, message and stack. Revisit in Phase 11 (observability) if log shipping needs a library.
- **Built incrementally, in execution order:** `route()` exists from W-003 with request IDs and the `{ data }` envelope and supports only `access: 'public'`; W-004 adds the error envelope and W-005 adds principal resolution and the access check. The `Clock` interface (`src/shared/time/clock.ts`) is introduced in W-003 because the system service needs it; W-006 builds the rest of the time module around it.
- **Health response:** `{ data: { status: 'ok' | 'degraded', database: 'up' | 'down', version, time } }`, `200` when the database answers and `503` when it does not. The database error is logged, never returned.
- **Architecture lint:** generated Prisma code is "do not follow" rather than excluded, so imports of it are still checked by rule 3. Each of the 13 rules was proven with a deliberate bad import.

---

### Decision 36: Error Handling Details Settled in W-004

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Test-only endpoints:** `/api/test-support/fail` (route) and `/test-support/server-error` (page) exist for the error E2E and integration tests. Both call `src/shared/http/testOnly.ts` first and answer **404 outside `APP_ENV=test`** (unit-tested, and checked by hand against a development server). The route is in the public allow-list because it carries no data and is unreachable outside tests.
- **Where shared types and UI live:** `ApiResponse<T>` and `FieldError` are in `src/shared/api/apiResponse.ts` (types only), so the browser bundle never imports `src/shared/http/route.ts`. Shared React components (`ErrorMessage`, `SupportContact`, the toast, the error-page body) are in a new `src/shared/ui/` folder.
- **Friendly errors only, by type:** `toFriendlyError()` is the only producer of the branded `FriendlyError` type, and `<ErrorMessage />` and `toastError()` accept only that type. Messages always come from the catalog by code; the only server text shown is the per-field messages of a `VALIDATION_FAILED` response. A browser-only `NETWORK_ERROR` sentence lives in the catalog file.
- **Zod messages:** input is parsed with a per-parse fallback, so a message a schema defines itself is kept and any library default becomes "Please check this field."
- **Error page reference:** for server render errors the page shows Next's `error.digest` as "Reference: …"; for API errors the reference is the `requestId`. Next.js 16.4 error components receive `error: unknown` and `retry()`.
- **The server-error E2E spec** is delivered in W-004 together with the not-found spec (both journey 8); W-008 part B keeps only the forbidden spec.

---

### Decision 37: Time Module Details Settled in W-006

**Date:** 2026-10-30
**Status:** Accepted (refines Decision 6)

#### Decision
- **The date ban also covers tests.** Outside `src/shared/time/`, ESLint rejects every `new Date(...)` and `Date(...)` call, `Date.now()`, `Date.parse()`, the local-time getters and setters, and `toLocale*`, `toDateString` and `toTimeString`. Tests build instants with `parseInstant("...Z")` and freeze time with `createTestClock()`, so a test can never pass only because of the machine's timezone.
- **Instants must carry a zone.** `parseInstant()` rejects an ISO string without `Z` or an offset, so nothing is ever read as local time.
- **Business dates** are `YYYY-MM-DD` strings; the Prisma `@db.Date` value is UTC midnight of that day (`businessDateToDbDate()` / `dbDateToBusinessDate()`).
- **Display styles** live in `src/shared/time/formats.ts` (`date`, `longDate`, `time`, `dateTime`) and use the `en-IN` locale from `APP_CONFIG`, for example "1 Jan 2027, 12:05 am".
- **Integration tests clean up after themselves** (or reset first) and pass in shuffled order.

---

### Decision 38: Access-Control Details Settled in W-005

**Date:** 2026-10-30
**Status:** Accepted (implements Decisions 4, 5 and 23)

#### Decision
- **Registry shape:** `PERMISSIONS` is a flat object keyed by code (`"system:view-diagnostics": { label, description, module, reserved }`); `PermissionCode` is its key type, so routes declare `{ permission: "system:view-diagnostics" }` and an unknown code does not compile. Reserved codes are flagged `reserved: true` in the same object.
- **Principal resolution:** `route()` asks `src/shared/rbac/principalResolver.ts`. Phase 0 resolves nobody. Tests replace it with `setPrincipalResolverForTests()`, which throws unless `APP_ENV=test`; test principals are built from the role's real grants in the test database (`src/tests/setup/principals.ts`). Phase 1 installs the session-based resolver.
- **Denials:** `FORBIDDEN` carries `{ permission, principalId }` as log context only; `toErrorResponse` writes it to the server log, and the body holds the catalog message.
- **Who may read the bypass flag:** the guard and the scope resolver decide on it. The identity module, which owns the role data, also reads the column to build principals and run the sync. A scan test fails if any other file reads `bypassesAccess` or compares role codes.
- **Diagnostics:** `GET /api/diagnostics` returns the health detail for now; W-012 adds the worker and jobs.
- **Prisma client format:** the generator emits CommonJS (`moduleFormat = "cjs"`). The ES-module client uses `import.meta.url`, which breaks inside the esbuild bundles (`dist/sync-rbac.js`, `dist/worker.js`). Next.js, Vitest and tsx all load the CommonJS client.

---

### Decision 39: Test Sign-In for E2E and the Diagnostics Page (W-008 Part B)

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Request identity is composed at server start** in `src/instrumentation.ts` (Next.js `register()`), which calls `configurePrincipalResolver()`. The configured resolver is kept on `globalThis`, because Next.js loads instrumentation and route code in separate bundles. Phase 1 installs the session resolver in the same place.
- **E2E acts as a role with a test-only cookie,** `eh_test_role=<ROLE>`: the resolver builds that role's principal from its real grants in the test database. It is installed only when `APP_ENV=test`; installing it otherwise throws (unit-tested), and a development server ignores the cookie (checked by hand: 401 even for `SUPER_ADMIN`). Playwright sets the cookie directly, so there is no extra test-only API route.
- **A `/diagnostics` page** (client component) reads `GET /api/diagnostics` through the shared API client, so the friendly 401/403 path is exercised end to end. Next.js's `forbidden()` / `unauthorized()` helpers are experimental (`authInterrupts`), so pages are not built on them for now; a refused page shows the catalog message inside the page.
- **E2E locators** scope `role="alert"` to `<main>`, because Next.js adds its own route-announcer element with that role.

---

### Decision 40: Seed Details Settled in W-009

**Date:** 2026-10-30
**Status:** Accepted (implements Decision 11)

#### Decision
- **Layout:** shared seed code lives in `prisma/seeds/` (`testSeed.ts`, `realSeed.ts`) and is imported through the `@seeds/*` path alias, so the committed template `prisma/seed.example.ts` and its private copy `prisma/private/seed.ts` use the same import. `prisma/seed-test.ts` is the test-seed entry point.
- **`npm run db:seed`** runs `scripts/run-real-seed.ts`, which explains how to create `prisma/private/seed.ts` when it is missing instead of failing with a module error.
- **First Super Admin password policy** (checked before anything is written): at least 12 characters, at least three of lowercase, uppercase, digits and symbols, and no placeholder (`change-me`) or common word (`password`, the company name, `qwerty`, `123456`). The committed `.env.example` value is therefore refused on purpose. Errors never echo the password.
- **`npm run guard:files`** also refuses tracked files under `storage/` (recordings and uploads), in addition to `prisma/private/` and real `.env*` files.

---

### Decision 41: Docker Details Settled in W-010 Part B

**Date:** 2026-10-30
**Status:** Accepted (implements Decisions 14 and 27)

#### Decision
- **Base image:** `node:${NODE_VERSION}-bookworm-slim` with `ARG NODE_VERSION=22`, kept in step with `.nvmrc` by a scan test.
- **Production stages:** `deps` (all dependencies) → `builder` (Prisma generate, `next build`, worker and tools bundles) → `migrator` (Prisma CLI, `prisma/`, `prisma.config.ts`, `dist/sync-rbac.js`) → `runner` (standalone output) and `worker` (production dependencies plus `dist/worker.js`). `runner` and `worker` run as `node` (uid 1000) on a read-only filesystem.
- **OpenSSL** is installed in the stages that run the Prisma CLI (`deps`/`builder` and `migrator`); without it the migration engine only guesses the OpenSSL version. The runtime images do not need it (the app uses the `pg` driver adapter).
- **Next.js cache tmpfs** is mounted with `uid=1000,gid=1000`: a default tmpfs is root-owned, so the `node` user could not write Next's cache. `local_setup.md` Section 10 is updated.
- **Image size:** the worker image is about 1.45 GB because the production dependencies include Next.js. Trimming the worker's dependencies is left to Phase 11.

---

### Decision 42: Background Job Details Settled in W-012

**Date:** 2026-10-30
**Status:** Accepted (implements Decision 27)

#### Decision
- **pg-boss 12.38.0**, in the `pgboss` schema. Only `src/shared/jobs/` imports it (architecture rule 8, re-proven against the installed package).
- **Test time:** integration tests use pg-boss's own `TestClock`, which also overrides the database-side clock (`pgboss.job_now()`), so JavaScript and Postgres agree on a hand-moved "now". This replaces the plan's fallback of editing pg-boss's start times by hand. `resetDatabase()` clears `pgboss.job` and `pgboss.job_dependency` and keeps queue definitions, which a running pg-boss caches.
- **Idempotency keys:** on a standard queue, pg-boss 12's `singletonKey` does not prevent a second job (seen in the integration test). `enqueue(..., { singletonKey })` therefore also sets the job ID to a UUID derived from the job name and key (`keyedJobId()`); pg-boss inserts with `ON CONFLICT DO NOTHING`, so the second `enqueue` returns `null`. The key stays taken while pg-boss keeps the job row.
- **Retries and alerts:** each job's retry policy is applied to its queue and to every job sent. The last failed attempt is logged as `ALERT: job failed permanently` with the job ID; earlier failures as warnings.
- **Worker status:** the worker writes a heartbeat every 5 seconds; diagnostics reports it `down` when the newest heartbeat is older than 30 seconds (constants in `system.types.ts` until `system_settings` exists in Phase 3).
- **The local Docker worker** gets `APP_HOST`, `APP_PORT` and `APP_URL`, because the environment check applies to every process and the worker will build links to the app.

---

### Decision 43: Live Update Details Settled in W-013

**Date:** 2026-10-30
**Status:** Accepted (implements Decision 28)

#### Decision
- **IDs only, enforced:** `defineEventType()` accepts only an object payload whose fields are strings (IDs); anything else fails at definition time. An encoded event over 4096 bytes is refused before NOTIFY.
- **Default deny:** an event type without `canReceive` is never delivered; an unknown type, a payload that fails its schema, or a filter that throws is dropped. Filters use the same permission checks as everything else (`can()`), never role names.
- **One channel:** `explorehills_events`. Each app instance keeps one `LISTEN` connection (kept on `globalThis`, like the principal resolver). If that connection drops, every open stream is closed, so browsers reconnect and re-fetch. App and worker publish with `pg_notify` through a small separate pool.
- **The stream:** `GET /api/events/stream` (`'authenticated'`) sends `retry: 3000`, a `: connected` comment once it is listening, a `: keep-alive` comment every 25 seconds, and the header `X-Accel-Buffering: no`. `route()` gained a raw-response result for it.
- **Browser:** `useLiveEvents()` passes notices to `onEvent`, re-fetches (`onResync`) after a reconnect, and polls with `onResync` every 15 seconds while the stream is down. It reports `connecting`, `live` or `polling`.
- **First real event:** `system.workerStatusChanged` (the worker publishes it on start and stop) lets the diagnostics page update the worker status without a refresh. A test-only `system.testPing` is registered only when `APP_ENV=test`.
- **Test sign-in IDs:** the test role cookie now gives each role a stable user ID (derived from the role code), so a test can aim a notice at one user.

---

### Decision 44: File Storage Details Settled in W-014

**Date:** 2026-10-30
**Status:** Accepted (implements Decision 26; the production target stays open, Decision 31)

#### Decision
- **Interface:** `put(key, body, contentType)` returns `{ sizeBytes, checksumSha256 }`; `get(key)` streams the file back (or `null`); `delete` of a missing key is a no-op; `exists`; `getTemporaryUrl(key, ttl)` returns a signed link or `null` (then the app streams the file after its permission check). The content type, size and checksum are stored with the record's metadata in the database; the local driver does not keep them beside the file.
- **Keys:** relative paths of ASCII segments (`A–Z a–z 0–9 . _ -`, not starting with a dot), at most 512 characters; `..`, a leading `/`, backslashes, empty segments and hidden names are rejected by every driver. `buildKey()` makes `<area>/<YYYY>/<MM>/<uuid>.<ext>` with the area from a fixed list (`recordings`, `uploads`, `exports`) and a UUID as the only identifier, so keys cannot carry personal data.
- **Local driver:** writes to a hidden temporary file in the same folder, syncs it to disk, then renames it into place; on any failure the temporary file is removed and an existing file under the key is left untouched. Reads stream in 64 KB chunks.
- **Startup checks:** the app (in `instrumentation.ts`) and the worker resolve the configured storage when they start, so a wrong or unbuilt driver stops them immediately. `STORAGE_DRIVER=s3` is accepted by the environment check but refused until the driver is built in Phase 7.
- **Contract suite:** `src/shared/storage/__tests__/storageContract.ts`; each driver's test calls `runStorageContract()`. The local driver runs it against `storage/test` in the integration tier.

---

### Decision 45: Phase 0 Acceptance (Fresh-Clone Drill) Findings

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
The W-015 drill followed `local_setup.md` Section 2 in a fresh clone of `main` (`f33b3f2`). Three gaps were fixed in the guide:
- **`npm run db:generate` after `npm ci`.** Without it, step 3 (`db:sync-rbac`) fails with "Cannot find module '@/generated/prisma/client'". A `postinstall` hook was rejected: the Docker images run `npm ci` before the schema is copied, and the production-only install has no Prisma CLI. Every CI job already runs `db:generate` explicitly.
- **`npx playwright install chromium`** is now step 7 of the quick start, with `npm run ci:quality`. The drill passed only because the browser was already cached on this machine.
- **Section 9 (local Docker full stack)** now says to complete Section 2 first: the containers use the checkout's source and its generated Prisma client.

In Phase 0 the diagnostics endpoint needs a signed-in user, which arrives in Phase 1, so "the worker shows as up" was checked through the test environment (the test-only admin cookie), as Section 2 already says.

---

### Decision 46: Authentication — Own Sessions Table

**Date:** 2026-10-30
**Status:** Accepted (resolves Decision 20; choices confirmed by the user on 2026-10-30; technical details approved with the Phase 1 plan on 2026-10-30)

#### Context
Staff sign in with an email and password. Decision 4 requires the principal and its permissions to be resolved on the server for every request, which a database-backed session does directly.

#### Decision (confirmed by the user)
- **Own sessions table, not Auth.js.** Sign-in, sign-out, password hashing and lockout are written in the `identity` module.
- **Session length:** a session expires after **12 hours without activity**; activity extends it, up to **7 days** after sign-in, after which the user signs in again.
- **Lockout:** **5 wrong passwords lock the account for 15 minutes**; a correct sign-in resets the count. Sign-in attempts are also limited per IP address.

#### Technical details (approved with the Phase 1 plan)
- **Passwords:** argon2id through `@node-rs/argon2` (prebuilt binaries, no compiler needed in Docker). The strength rule is the one the real seed already applies (Decision 40), shared from one place.
- **Session token:** 32 random bytes, sent only in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). The database stores only its SHA-256 hash (`identity_sessions.tokenHash`), never the token. Activity extends `expiresAt` at most once every 5 minutes, to avoid a write on every request.
- **Cross-site requests:** requests that change data (POST, PUT, PATCH, DELETE) with a session cookie must come from the app's own origin (`APP_URL`); others are refused with `FORBIDDEN`.
- **Per-IP limit:** at most 20 sign-in attempts per IP address per 15 minutes, counted in a small Postgres table so it holds across app instances.
- **What the user is told:** a wrong email or password gives one message that does not reveal whether the account exists (new catalog code `INVALID_CREDENTIALS`); a locked account or a throttled IP gets the existing `RATE_LIMITED` message.
- **Who can sign in:** only `ACTIVE` users. Deactivating a user revokes all their sessions; a role or permission change applies on the next request, because the principal is rebuilt every time.
- **Audit:** sign-in, sign-out, lockouts and every user change are written to `audit_events` (the table and writer arrive in Phase 1, Decision 23).

---

### Decision 47: Test Scenario Catalogue and When Phases Are Planned

**Date:** 2026-10-30
**Status:** Accepted (chosen by the user)

#### Decision
- `CONTEXT/test_scenarios.md` lists the edge and special cases of every phase in plain language, written once now and kept up to date. It lists what must be true, not test code.
- Detailed work items are still written when a phase arrives, in the `TDD_INSTRUCTION_GUIDE.md` format, from the code that exists by then. Plans for all phases are not written in advance, because they would go stale and some depend on open decisions.
- **Coverage rule:** every scenario of a phase maps to a real test in that phase's plan, by ID, or moves to a named later phase with the reason. New edge cases and production bugs are added to the catalogue in the same change.
- The session prompt and the TDD guide carry these rules, so they apply in every new session.

---

### Decision 48: Passwords Are Set by an Admin; Employee Page

**Date:** 2026-10-30
**Status:** Accepted (chosen by the user; answers `test_scenarios.md` Q-01 and Q-02; amends Decision 46)

#### Decision
- **An Admin gives each user a default password when creating them, and afterwards only an Admin changes it,** from the Admin portal. There is no "forgot password" flow and users do not change their own password.
- **The Admin portal has an employee (agent) page:** a list of employees where clicking a record opens that person's details to view and edit, including setting a new password. The page is built with the Phase 2 user management screens; its API arrives in W-104.
- **Changing a password signs that user out of all their running sessions**, in the same transaction.

#### Details (confirmed by the user on 2026-10-30, Decision 49)
- The default password follows the Decision 46 strength rule, and is never shown again, logged or audited (the audit event records only that it changed).
- Changing a password also clears that user's failed-attempt count and lock.
- An Admin cannot change a Super Admin's password (Decision 23); a Super Admin can.
- A user created with a password is `ACTIVE` immediately, so `INVITED` may go unused.
- Recovery if the only Super Admin forgets their password: a private operator command (Decision 49).

---

### Decision 49: Phase 1 Rules Settled With the Revised Plan

**Date:** 2026-10-30
**Status:** Accepted (the first four confirmed by the user; the rest proposed with the revised Phase 1 plan)

#### Decision
**Confirmed by the user**
- A forgotten password of the only Super Admin is reset by a private operator command on the server. No web route can do it.
- Default passwords follow the same strength rule as every other password.
- Guesses during a lock are refused and do not extend it, so a lock always ends after 15 minutes. An attacker can re-lock an account afterwards; the per-IP limit slows this and every lockout is audited.
- A user created with a default password is `ACTIVE` immediately.

**Proposed with the plan**
- Passwords longer than 1024 bytes are refused before hashing, and hashing runs with limited concurrency.
- The client IP is read from `X-Forwarded-For`, counted from the right by a `TRUSTED_PROXY_HOPS` setting (default 0: the value our own server added), so a value faked by the caller is ignored. If no address can be read, attempts share one limited "unknown" bucket.
- A write with a session cookie and no `Origin` header is refused.
- A deactivated user's email stays taken, and reactivation restores the account.
- Nobody can change their own role or deactivate themselves.
- Two simultaneous removals of Super Admins are serialised inside the transaction, so at least one active Super Admin always remains.
- Only if there is no active Super Admin does the real seed create one; if the email belongs to a deactivated account, it refuses with a clear message.

---

### Decision 50: Password Details Settled in W-102

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Hash settings:** argon2id with 19 MiB of memory, 2 iterations and 1 thread (OWASP's minimum), set explicitly rather than left to the library's lighter defaults. At most 4 hashes run at once; the rest wait.
- **Unicode:** a password is converted to NFC before hashing and verifying, so the same characters typed on different keyboards match. Nothing else is changed: case and spaces still matter.
- **Personal details:** a password is refused if it contains the user's full email, the part before the `@`, their full name, or any part of their name of 3 or more characters, ignoring case.
- **Non-Latin characters** count as symbols, so the Decision 40 rule gives the same results as before. A password written only in Hindi has one character class and is refused as weak; one that also has Latin letters or digits is accepted.
- **Unknown user:** a dummy hash, built once from random bytes when first needed, is verified so the response time does not reveal which accounts exist.

---

### Decision 51: User Rules Settled in W-104

**Date:** 2026-10-30
**Status:** Accepted

#### Decision
- **Your own account:** you can edit your own name, email and phone. You cannot change your own role, deactivate yourself or set your own password, and this applies to a Super Admin too. The operator command (Decision 49) covers a forgotten Super Admin password.
- **Permissions:** setting a password needs `users:edit`; reactivating needs `users:deactivate`.
- **Admins and Super Admins:** an Admin can see Super Admin accounts but cannot change them.
- **Simultaneous changes:** every user change takes one Postgres transaction lock, so the count of active Super Admins cannot be read by two changes at once. User changes are rare, so the queue costs nothing noticeable.
- **Repeats:** deactivating someone already deactivated, reactivating someone already active, and an edit that changes nothing all succeed without writing or auditing.
- **The list:** `GET /api/users` is paged (50 by default, 200 at most), sorted by name, and shows every user until team scope arrives in Phase 2. Phase 2 adds the sorting and filters its screens need.

---

### Decision 52: Sign-In Details Settled in W-105

**Date:** 2026-10-30
**Status:** Accepted (amends the W-105 plan)

#### Decision
- **Unknown emails lock too.** An unknown email and an inactive account behave alike: their failures are counted in `identity_login_throttle` under a keyed hash of the email, and lock after 5 for 15 minutes, so lockout cannot reveal which accounts exist (`P1-LOCK-08`). The email is never stored. One small difference remains: a real account's count never ages, while W-110 removes these rows a day after their last failure.
- **The fifth wrong password** is itself answered with `RATE_LIMITED`, and is the attempt that starts the lock.
- **Sign-out is public**, not `'authenticated'` as first planned, because `P1-SESSION-10` needs a repeat or an expired session to succeed quietly. It only ends the session named by its own cookie, and the Origin check still applies.
- **Stale checks:** a sign-in succeeds only if the account is still active, unlocked and has the same password hash that was just verified, so a password changed at that moment shuts the old one out.
- **Throttle keys** are HMAC-SHA-256 with `AUTH_SECRET`, so a leaked table cannot be checked against a list of addresses or emails.
- **Sessions** leave `ip` and `userAgent` empty for now: nothing uses them, and it is personal data we would have to retain.
- **Wording:** `INVALID_CREDENTIALS` uses the owner's design: "That email and password don't match. Check for typos and try again."
- **Not decided here:** the lockout countdown in the design. `RATE_LIMITED` stays one fixed sentence until the owner answers.

---

### Decision 53: Visual Design and the Sign-In Screen

**Date:** 2026-10-30
**Status:** Accepted (chosen by the owner)

#### Decision
- **Source:** the owner's Claude Design canvas, https://claude.ai/artifact/32WPUfjbM7wzUVWrH25twN, is the reference for every screen.
- **Theme:** Noto Sans with Noto Sans Devanagari, and Instrument Serif italic as an accent. Primary blue `#1468F0`, a `#F6F7F9` grey canvas with white surfaces. Light mode only in v1.
- **No "Keep me signed in" checkbox:** the design's checkbox is left out, because Decision 46 sets one session rule for everyone.
- **No lockout countdown:** a locked account shows one fixed message and the form stays usable, because a countdown would need a real lock timer and unknown emails must look the same (`P1-LOCK-08`).

---

### Decision 54: Module UI Is Imported Directly

**Date:** 2026-10-30
**Status:** Accepted (amends the import rules in `project_data.md` Section 4.2, rule 1)

#### Decision
`src/app` may import `src/modules/<module>/ui/**` directly. A module's `index.ts` pulls in server code such as Prisma and the password library, so going through it would put that code in the browser bundle. The rule that UI never imports server code still holds, and `lint:arch` still enforces it.

---

### Decision 55: Team Visibility, Several Teams, and Reassign Before Removing

**Date:** 2026-10-31
**Status:** Accepted (chosen by the owner; answers `test_scenarios.md` Q-03 and Q-04)

#### Decision
- **Team visibility covers the whole chain below a person**, not only direct reports. A person also sees the members of teams they manage, and everyone below those members.
- **A person can belong to several teams.** Membership moves to a join table, `identity_team_members`, replacing the planned `identity_users.teamId`. Each person still has one manager (`managerId`).
- **Reassign before removing.** A manager with active reports or a team cannot be deactivated, and a team with members cannot be deleted, until those are moved. A deactivated report does not block their manager.

---

### Decision 56: Details Settled in Phase 2

**Date:** 2026-10-31
**Status:** Accepted

#### Decision
- **New permissions:** `users:view-all`, `teams:view`, `teams:view-all`, `teams:manage`. Admin has all four and Manager has `teams:view`. `users:view` alone now means "my branch"; out-of-scope records answer "not found".
- **The Employees page needs `users:edit`,** so a Manager cannot open it (`P2-UMGMT-06`), though the API still lets a Manager read their own branch, and the Teams page shows it.
- **Built-in roles can't be renamed:** Decision 23 lists renaming for custom roles only, so the design's Rename button appears only on custom roles.
- **A role's code is made from its first name and never changes.** A name with no Latin letters gets a generated code.
- **Two editors of one role:** each edit names the version it started from; the second gets `CONFLICT` and changes nothing.
- **Open live-update streams** ask who the user is before every event, so a changed permission applies at once and an ended session closes the stream (`P2-ROLES-13`).
- **The browser now receives the specific reason on a `CONFLICT`,** not only on `VALIDATION_FAILED`. Phase 1's refusals, such as "last Super Admin", would otherwise show the generic "changed by someone else".
- **Not built from the design, because nothing is behind it yet:** Workload and Recent changes on the employee record (Phases 5, 9, 10), open-lead counts on Teams (Phase 3), the lead choices in the deactivate dialog (Phase 5, `P2-UMGMT-03`), "On leave" status, and team regions. "Suggest a password" is left out as a small extra. The design's "at least 10 characters" hint is corrected to the real rule of 12.

---

### Decision 57: Lead Rules Settled for Phase 3

**Date:** 2026-10-31
**Status:** Accepted (the first rule chosen by the owner, answering `test_scenarios.md` Q-05; the rest set with the Phase 3 plan and reported to the owner)

#### Decision
- **A returning customer gets a new lead, linked to the same contact.** Their earlier leads stay as they were, and the lead page lists them.
- **One open lead per contact.** Creating another is refused, with a link to the existing lead when the person may see it. A won or lost lead does not count.
- **Who owns a new lead:** someone with `leads:assign` may choose an owner in their scope or leave it unassigned for the queue. Anyone else, such as an agent, owns what they create; otherwise it would vanish from their own list.
- **Who sees what:** own = leads they own. Team = leads owned by anyone in their branch, plus unassigned leads, which are the manager's queue. All = every lead.
- **Stages:** any open stage can be reached from any other, so stages can be skipped. Lost needs a reason. Reopening a won or lost lead needs only `leads:edit` in scope, and clears the closed time and reason.
- **Travel dates:** a past start date is allowed, because enquiries are sometimes logged late.
- **Numbers:** travellers 1 to 500; budget up to ₹100 crore with two decimals.
- **Custom fields:** only `stay` and `language` are accepted. Unknown fields are ignored and never stored.
- **Deleting:** always a soft delete, by `leads:delete`, with no restore in this phase. A customer who returns gets a new lead on the same contact, and a soft-deleted contact is brought back. An anonymised contact (Phase 10) no longer holds a matching number, so it is treated as new.
- **Notes can't be edited or deleted,** so the history stays trustworthy. The design's Edit link is left out.
- **Follow-ups are tasks.** A task needs an assignee who is active and in the actor's scope. A past due date is refused at creation. Completing twice changes nothing, and a done task can be reopened. A lead's next follow-up is its earliest open task, cleared when the lead closes, so closed leads stop reminding.
- **A changed setting applies to new work only;** work already running keeps the value it started with.

---

### Decision 58: WhatsApp Rules Settled for Phase 4

**Date:** 2026-10-31
**Status:** Accepted (the first three chosen by the owner, answering `test_scenarios.md` Q-06, Q-07 and Q-08; the rest set with the Phase 4 plan and reported to the owner)

#### Decision
- **Route:** Meta directly or a reseller, chosen later. Everything is built against the `fake` gateway, which speaks Meta's webhook format. Production refuses `fake`, so a real adapter must exist before go-live.
- **No SMS.**
- **Opt-out and opt-in:** a message that is exactly STOP, UNSUBSCRIBE, or a Hindi equivalent (`बंद`, `बंद करो`, `रोको`, `अनसब्सक्राइब`), in any case, opts the customer out. Words inside a longer sentence do not. A customer messaging us first counts as opted in. An opted-out customer stays opted out until they send START or `शुरू`; an ordinary message doesn't undo it. Staff can record agreement only for a customer with no recorded choice, never over an opt-out.
- **Sending to an opted-out customer is refused for everything,** free-form replies included.
- **Who sees a conversation follows its lead:** the same own, team and all scope. `ownerUserId` is therefore not copied onto the conversation (a change from `database_schema.md`), so the two can't disagree.
- **A deactivated owner's chat** stays visible to everyone above them and to view-all roles.
- **Status order:** QUEUED, SENT, DELIVERED, READ only ever move forward. FAILED applies only before delivery. A status that arrives before we know its message is kept and applied when the send completes.
- **Every send runs as a job,** so a provider outage or rate limit slows sending down without losing anything. The window and template are checked again when the job runs. Double clicks are stopped by a key the browser generates for each message.
- **Files:** received files up to 25 MB of an allowed type (images, PDF, Office documents, audio, video) are stored, and always downloaded rather than shown in the browser. Sending: images 5 MB, audio and video 16 MB, documents 25 MB (WhatsApp allows 100 MB for documents; 25 MB protects the server).
- **Merging leads** needs a new permission, `leads:merge` (Admin and Manager). The other lead's notes, follow-ups, timeline and chats move to the survivor, and the other lead is soft-deleted with a pointer to it.


---

### Decision 59: Assignment Rules Settled for Phase 5

**Date:** 2026-10-31
**Status:** Accepted (the first four chosen by the owner, answering `test_scenarios.md` Q-09 to Q-12; the rest set with the Phase 5 plan and reported to the owner)

#### Decision
- **Overnight shifts (Q-09):** a shift may cross midnight and counts toward the day it started. So leave is checked against that starting day: at 02:00 on Tuesday, a Monday-night shift is a Monday shift. A shift's start minute is inside the shift and its end minute is outside.
- **Leaving staff (Q-10):** the person deactivating chooses: move the open leads to the manager queue (the default), give them all to one agent, or leave them with the person. Follow-ups move with the leads.
- **Timeouts and shifts (Q-11):** the response timer counts only during the agent's shifts. An agent with no shifts set is always counting. The deadline is worked out once, at assignment, so a later change to a setting or a shift does not move it.
- **Bounce limit (Q-12):** `assignment.maxTimeouts`, default 2. An earlier timeout returns the lead to the queue. Reaching the limit in a row returns it and flags it for a manager. A response resets the count.
- **Defaults confirmed by the owner:** blast pool 5 minutes, default cap 12 open leads, recordings kept 90 days.
- **Who can be given leads:** an active person whose role holds `leads:claim`. It is checked by permission, never by role name.
- **Eligibility:** available, not on leave, on shift, under their cap (a cap of zero means no leads). An agent's languages and destinations limit what they get. An empty list means anything, and a lead with no language or destination can go to anyone.
- **Preview and confirm:** a preview changes nothing. Confirming sends the previewed plan, and each row is checked again. A lead someone else took is skipped, and a lead whose agent can no longer take it stays in the queue. The manager is told both counts. An unexpected failure rolls back the whole batch.
- **Fairness:** round-robin starts with whoever has waited longest since their last assignment, and people never assigned come first. Least-loaded breaks ties the same way. Priority fills the highest tier first. By value, the highest budget goes first, leads with no budget go last, and equal values go oldest first.
- **What counts as a response:** a reply, a call, a note, a stage change or a new follow-up by the owner. Editing lead details does not count, and neither does a customer message.
- **Timed-out leads go back to the queue.** That also holds with no eligible agents left, and auto-assign does not pick them up again.
- **Blast:** a lead in a pool stays in the queue, marked and not selectable. The first valid claim wins, and a claim needs `leads:claim` and current eligibility. An unclaimed entry expires back to the queue. Assigning a lead closes its entry, and a deleted or merged lead can't be claimed.
- **Reassigning** needs `leads:reassign` and a reason. The new owner must be an active agent in scope, but may be off shift or over their cap, because a manager is overriding. Reassigning to the current owner does nothing. Open follow-ups of earlier owners move to the new owner.
- **On leave:** an agent keeps their leads. Timers keep running, so unanswered leads return to the queue.
- **Auto-assign:** one active rule at most. A sweep checks every minute, so a new lead is assigned within about a minute. It applies to each new lead once, and only to leads that are still unassigned.

---

### Decision 60: Agent Workspace Rules for Phase 6

**Date:** 2026-10-31
**Status:** Accepted (set with the Phase 6 plan and reported to the owner)

#### Decision
- **Looking at a lead creates nothing.** A chat starts only when someone asks, so viewing leads doesn't fill the inbox with empty conversations.
- **A lead that moves away while open** stays on screen with a notice. Editing stops, and typed text stays so it can be copied.
- **Chats load the newest 50 messages,** with older ones on request. The reader's place holds when older messages load, and new messages scroll the view only for someone already at the end or for their own message.
- **Quick filters** are Open, Overdue, Due today and No follow-up. Their counts ignore the chosen quick filter but respect the other filters.
- **Shortcuts:** N (note) and F (follow-up) on a lead; J, K, Enter and / on the list. None fires while typing, inside a dialog or with a modifier held.
- **Phones** get a bottom tab bar with the first four of Queue, Leads, Inbox, Follow-ups and Blast pool that a person can open, and the rest under More.

---

### Decision 61: Out-of-Hours Calls and the Recording Announcement

**Date:** 2026-10-31
**Status:** Accepted (the message and alert rule chosen by the owner, answering `test_scenarios.md` Q-13; the wording delegated to Claude in Q-15, and changeable; the rest set with these and reported to the owner)

#### Decision
- **Out of hours:** the caller is asked to leave a message, and we get back to them in working hours. The message is stored on the lead like a call recording.
- **Missed-call alert:** goes to Admins and to the manager of the lead's owner. With no owner or no manager, it goes to everyone who can assign leads. It appears on screen in Phase 7; email and push wait for `Q-17` in Phase 8.
- **Working hours:** a setting, starting at Monday to Saturday, 10:00 to 19:00 IST. This default is a placeholder for the owner to correct. Holidays wait for `Q-16`.
- **Out-of-hours wording (English):** "Thank you for calling {company}. We're closed right now. Please leave a message after the tone, and we'll get back to you during working hours."
- **Out-of-hours wording (Hindi):** "{company} को कॉल करने के लिए धन्यवाद। अभी हमारा कार्यालय बंद है। कृपया बीप के बाद अपना संदेश छोड़ें। हम कार्य समय में आपसे संपर्क करेंगे।"
- **Recording announcement (English):** "This call may be recorded for quality and training purposes."
- **Recording announcement (Hindi):** "गुणवत्ता और प्रशिक्षण के लिए यह कॉल रिकॉर्ड की जा सकती है।"
- **The wording is stored as settings,** so it can change without a release. A legal adviser still has to confirm the recording notice under the DPDP Act (`Q-19`, Phase 10).
