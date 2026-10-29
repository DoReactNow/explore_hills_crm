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

### Decision 19: Open — WhatsApp Integration Route

**Date:** 2026-10-28
**Status:** Open (needed by Phase 4)

Options: direct Meta Cloud API (no platform fee, more integration work) or through a WhatsApp provider (faster start, platform fee and dependency). The messaging module hides the choice behind a `WhatsAppGateway` interface so the decision can change without touching leads or assignment.

---

### Decision 20: Open — Authentication Approach

**Date:** 2026-10-28
**Status:** Open (needed by Phase 1)

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
