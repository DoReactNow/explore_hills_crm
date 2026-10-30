# TDD Instruction Guide: How to Write Work Items for Explore Hills CRM

Every implementation task in this project is written as a **TDD checklist work item** and executed exactly as written. This guide defines the format, the order, and the project-specific rules. Read it before planning any phase.

**The one rule:** write the failing test first, see it fail for the right reason, then write the smallest code that makes it pass, then refactor with the tests green.

> **Updated 2026-10-29** for Decisions 21–31. Test-first is **mandatory** for the risky core (assignment engine and modes, blast-claim concurrency, timeouts and every background job, webhook idempotency, RBAC guard / Super Admin bypass / scope, the time module, and the adapter contract suites). For plain CRUD screens, tests may be written alongside the code, but the coverage list in Part 4 still applies (Decision 29). E2E covers only the critical journeys in Decision 29.

---

## Part 1: The Process

### 1.1 Planning before coding (mandatory for every phase)

1. Read `current_state.md` and find the first `PENDING` phase.
2. Check `decision_log.md` for any **Open** decision that phase needs (for example the calling provider, Decision 30). If one is open, or anything else needs the user's input, ask the user first and log the answer before planning.
3. Read that phase's section and "Rules for every feature" in `test_scenarios.md`, and answer its open questions with the user.
4. Investigate the existing code first. Read what is already built in that area, the schema, the permission registry and the related modules. Do not plan from assumptions.
5. Write the phase plan as a list of work items (Part 2 format) **in `current_state.md`** under that phase.
6. **Coverage rule (Decision 47):** every scenario of the phase must map to a test in a work item, by its ID (for example `P1-LOCK-05`), or be moved to a named later phase with the reason. List any moved scenarios in the plan. A plan with unmapped scenarios is not ready.
7. Show the plan to the user and **wait for approval**. Do not write code during planning.
8. Execute the items in order. Tick each checkbox as it is completed. Do not start the next phase until every box in the current phase is ticked.

### 1.2 Work item numbering

Phase N items are numbered `W-N01`, `W-N02`, and so on (Phase 0: `W-001`…, Phase 5: `W-501`…). One work item is one user-visible capability or one infrastructure capability, small enough to finish and verify in one sitting.

### 1.3 The execution loop for each work item

```
1. Write the RED tests          -> run them -> confirm they FAIL for the expected reason
2. Write the minimal GREEN code -> run them -> confirm they PASS
3. Refactor                     -> run them -> still PASS
4. Run the verification chain   -> every command green
5. Tick the checkbox in current_state.md
```

If a test passes before you wrote the code, the test is wrong. Fix the test first.

---

## Part 2: Work Item Template

Copy this template for every item. Fill every section. Delete none.

```markdown
### W-XXX: <Short title: the capability, not the technique>

**Goal:** One or two sentences. What can a user (or the system) do after this that it could not before?

**Why now / dependencies:** What must already exist. What this unblocks.

**Permissions and roles:** Which permission codes guard this (from `project_data.md` Section 5). Which roles hold them by default (Super Admin always passes through the bypass). "None (public)" must be justified and added to the public allow-list. A reserved code (`roles:manage`, `users:manage-super-admins`) means Super Admin only.

**Data and time:** Tables and columns touched. For every date field, state whether it is an *instant* (`timestamptz`) or a *business date* (`date`).

**Errors the user can see:** Each failure path and its catalog code (`VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, ...). Confirm the user-facing message comes from the catalog.

**Module boundaries:** Which module owns this. Which other modules it talks to, through which public API or event. Which foreign keys it adds across modules, with their `onDelete` (Decision 22).

**Jobs, live updates, adapters:** Background jobs it adds or enqueues (name, trigger, idempotency key). Live-update event types it publishes and who may receive them. Any provider, gateway or storage interface it uses, and which `fake`/`local` implementation the tests use. Write "None" if not applicable.

#### Step 1: Schema and migration
- [ ] Change `prisma/schema.prisma`
- [ ] Create the named migration: `npm run db:migrate:dev -- --name <snake_case>`
- [ ] Migration is backward compatible (expand/contract)
- [ ] `npm run db:test:migrate` applies cleanly on an empty test database
- [ ] `npm run db:generate`

#### Step 2: RED tests (write first, watch them fail)
- [ ] Unit: <service rule 1>, <service rule 2>, <edge case>, <permission/scope rule>
- [ ] Integration: <route + real DB scenario 1>, <scenario 2>, <forbidden scenario>, <validation scenario>
- [ ] Jobs (if any): <handler rule>, <idempotency: run twice = one effect>, <retry/final failure>, <delayed job fires at the right time with the clock advanced>
- [ ] E2E (only if this item delivers one of the critical journeys in Decision 29): <flow>
- [ ] Name the `test_scenarios.md` IDs each test covers
- [ ] Run each tier and record the expected failures

#### Step 3: GREEN implementation (one layer at a time, bottom up)
- [ ] Types and Zod schemas (`<module>.types.ts`, `<module>.schemas.ts`) with friendly messages
- [ ] Repository (`<module>.repository.ts`)
- [ ] Service (`<module>.service.ts`) including scope rules, events and live-update notices
- [ ] Jobs (`<module>.jobs.ts`) and live-update event types (`<module>.events.ts`), if any, exported from `index.ts`
- [ ] Public API (`index.ts`) if other modules need it
- [ ] Controller (`<module>.controller.ts`) with the access declaration
- [ ] Route adapter (`src/app/api/.../route.ts`)
- [ ] Frontend (`ui/` and page), using the shared API client and the friendly error mapper

#### Step 4: Verification chain
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run build:worker`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e` (if the item touches a critical journey)
- [ ] Manual check in the browser for visual and interaction quality (UI items)
- [ ] `current_state.md` updated; decision logged in `decision_log.md` if a design choice was made
```

**Order inside a work item is fixed:** schema → RED tests → GREEN code (bottom up) → verification chain. The build runs before the tests, as in `ci:quality`.

---

## Part 3: Project-Specific Rules (every work item must satisfy these)

### Rule 1: Every action is guarded
Every `route()` declares its access. Use a registered permission code. Never invent a string. A new permission is added to `src/shared/rbac/permissionRegistry.ts` (and `defaultRoles.ts` if the default roles hold it) first, then used. The route-guard coverage test must stay green.
- RED test: the allowed role succeeds; a role without the permission gets `403`; an unauthenticated request gets `401`; a Super Admin succeeds through the bypass.
- Never check role names in feature code. The bypass (`bypassesAccess`) is read only by the guard and the scope resolver.

### Rule 2: Permission names never reach the user
The `403` response body and every page must show the generic catalog message only. Assert in the integration test that the response body does not contain the permission code. The only screen that may show a code is the Roles & Permissions page (Super Admin only), as secondary text next to the human-readable label (Decisions 5 and 29).

### Rule 3: Friendly errors only
Every failure path maps to a catalog code. New situation → add a catalog entry with a friendly message **before** using it. Assert the `error.message` equals the catalog message, and that no stack, SQL, table name, library name or internal ID appears. Frontend code renders only the mapped friendly text.

### Rule 4: Time and dates
- Instants use `timestamptz`; calendar days use `date` and travel as `YYYY-MM-DD` strings.
- All date logic goes through `src/shared/time/`. Never write `new Date()`, `Date.now()` or `toLocale*` outside it (ESLint will fail).
- Any item that filters or groups by day, "today", "overdue" or "this week" needs a RED test with the clock frozen just **before** and just **after** local midnight in the business timezone, proving the record lands on the right day.
- Services use the injected `Clock`.

### Rule 5: Single source of truth
No literal email, phone, product name, company name, timezone, permission code, error message or date format outside its registry (`project_data.md` Section 7). If a new shared value is needed, add it to the registry first. The SSOT scan test must stay green.

### Rule 6: Module boundaries
New cross-module need → use the other module's `index.ts` public API or publish an event. Never import another module's repository, service file or internals. If the other module lacks the API, add it to that module. `npm run lint:arch` must pass.
- A repository **writes** only its own module's tables. It may **read** another module's tables through Prisma relations for display or reporting (Decision 22).
- Cross-module foreign keys are allowed and must state `onDelete`: `Restrict` by default, `SetNull` with a written reason, never `Cascade` across modules. Add the back-relation field in the same change.

### Rule 7: Data scope
Anything that returns lead, conversation or call data is scoped by the principal (own / team / all). The service resolves visible agent IDs and passes them to the repository.
- RED tests: an agent cannot read another agent's record (the response is `NOT_FOUND`, not `FORBIDDEN`, so existence is not leaked); a manager sees the team's records; a role with `view-all` sees all; a Super Admin sees all through the bypass.
- Live-update events are filtered with the same scope rules before they reach a browser.

### Rule 8: Assignment changes are atomic and audited
Any change of lead ownership runs in one transaction, uses an atomic claim where races are possible (BLAST), is idempotent for repeated submissions, and publishes an audit event with actor, previous owner, new owner, mode, reason and time.
- RED tests: two simultaneous claims → exactly one wins and the other gets `CONFLICT`; the same bulk request sent twice does not double-assign; an audit event exists for every change.

### Rule 9: WhatsApp rules
Free-form messages only inside the 24-hour window, templates otherwise, enforced in the service. Inbound webhooks verify the signature and are idempotent by Meta message ID. Phone numbers are normalised to E.164.

### Rule 10: Telephony adapter rules
- Every provider implements both `TelephonyProvider` (server) and `SoftphoneClient` (browser) inside `src/modules/telephony/providers/<key>/`, and must pass the shared **contract test suite** (with recorded webhook fixtures) before it can be selected.
- Code outside the provider folder never names a provider; it checks capability flags.
- Webhooks are verified, stored raw, and processed by a job; processing is idempotent by provider event ID and matches the call by our `callRef` first, then by normalised phone number.
- Provider statuses are mapped onto `TelephonyCallStatus`.
- Tests use the `fake` provider. No test calls a real provider.

### Rule 11: Migrations
Any schema change has a named migration. Never edit an applied migration. Migrations are backward compatible with the previous app version. `db:migrate:check` must pass.

### Rule 12: Test data and environments
Tests use the test database and `.env.test` only. Data is created through `prisma/seed-test.ts` or test helpers, never through the real seed and never with real names, phone numbers or emails. Integration tests never mock Prisma. Test credentials come from `.env.test`.

### Rule 13: No hard-coded environment values
No `localhost`, ports, URLs or secrets in code. Read them through `src/shared/config/env.ts`. Use `127.0.0.1` in any example or script.

### Rule 14: Background jobs
- Define jobs in `<module>.jobs.ts` with `defineJob()` (name, Zod payload, handler, retry policy) and export them from the module's `index.ts`; the worker entry assembles them. Handlers call the module's service, never Prisma.
- Every handler is **idempotent**. RED test: run it twice with the same payload → one effect.
- RED tests for retries and final failure (alert logged), and for delayed jobs firing at the right time with the `Clock` advanced. Never wait on real time.
- Integration tests run queued jobs with `runPendingJobs()`; they never need a running worker.
- Webhooks only verify, store and enqueue; the work happens in a job.

### Rule 15: Live updates
- Declare event types in the owning module's `<module>.events.ts` and export them from `index.ts` (the stream route assembles them). Payloads carry IDs only (no personal data, under 4 KB).
- Every event type has a receive filter based on permission and scope; no filter means nobody receives it.
- The browser re-fetches through the normal API after a notice; screens must also work with the polling fallback.

### Rule 16: Swappable integrations and files
- Calling providers, WhatsApp gateways and storage drivers are used only through their interfaces and chosen by env (`TELEPHONY_PROVIDER`, `WHATSAPP_GATEWAY`, `STORAGE_DRIVER`). Only the registry imports an implementation.
- Every implementation passes its shared contract suite. Tests use `fake` / `local` only.
- No audio or other file bytes are ever stored in the database: save through `FileStorage` and keep the key plus metadata. Keys never contain personal data.
- Secrets live in env only; stored provider credentials use `*Encrypted` columns.

### Rule 17: Roles, Super Admin and reserved permissions
- Reserved codes (`roles:manage`, `users:manage-super-admins`) are never granted to any role. RED test: the service rejects it and the database trigger rejects it.
- Protect the last active Super Admin (`CONFLICT`), and never let an Admin create, edit, deactivate or promote a Super Admin.
- `db:sync-rbac` must never overwrite grants edited on the Roles & Permissions page (Decision 23). Any change to the sync needs a RED test for this.

---

## Part 4: Test Tier Guide

| Tier | File name | What to test | What not to do |
|:---|:---|:---|:---|
| **Unit** | `*.unit.test.ts(x)` beside the module in `__tests__/` | Service rules with a mocked repository, guard decisions, error mapping, time helpers, scope resolution, Zod schemas, React components, architecture and SSOT scans | Touch a database or the network |
| **Integration** | `*.int.test.ts` in `__tests__/` | Call the route handler with a real `Request`, with a principal for a seeded test user, through to the real test database. Assert status, body shape and the database state afterwards | Mock Prisma or the repository |
| **E2E** | `e2e/*.e2e.ts` | Only the 8 critical journeys in Decision 29, in a real browser against the **built** app with the `fake` provider and gateway | Test logic already covered below it; add journeys outside the list without logging a decision; rely on timing sleeps |
| **Contract** | `<interface>/__tests__/*Contract.ts`, run by each implementation's test | The behaviour every provider, gateway or storage driver must share | Call a real external service in the normal test run |

**Always assert the response envelope.** Success is `{ data }`; failure is `{ error: { code, message, requestId } }`. Mocks and fixtures use the shared `ApiResponse<T>` type so they cannot drift from the real shape.

**Cover, for every endpoint:** success, validation failure, unauthenticated, forbidden, not found, conflict (if applicable), and scope.

**Cover, for every list screen** (sorting, filtering, pagination): every sortable column sorts correctly in both directions, every filter narrows the data correctly alone and combined, filter and sort state survive navigating away and pressing Back, empty state and error state show friendly text.

---

## Part 5: Worked Example

### W-501: Manager bulk-assigns unassigned leads with round-robin

**Goal:** A manager selects unassigned leads, picks `ROUND_ROBIN` and some agents, sees a preview, confirms, and the leads are distributed fairly with an audit trail.

**Why now / dependencies:** Needs leads (Phase 3) and users and teams (Phase 2).

**Permissions and roles:** `leads:assign` (ADMIN, MANAGER by default).

**Data and time:** `assignment_batches` (instant `createdAt`), `assignment_records` (instant `responseDueAt`), lead ownership `leads_leads.ownerUserId` (cross-module foreign key to `identity_users`, `onDelete: Restrict`; written through the `leads` public API).

**Errors the user can see:** `FORBIDDEN` (agent), `VALIDATION_FAILED` (no leads, no agents), `CONFLICT` (a lead was already assigned) with friendly messages.

**Module boundaries:** `assignment` module owns the engine. It calls `leads` and `identity` through their public APIs, and publishes `lead.assigned` events consumed by `audit`.

**Jobs, live updates, adapters:** enqueues one `assignment.responseTimeout` delayed job per assigned lead (idempotency key = assignment record ID); publishes the `lead.assigned` live-update notice to the new owner and to managers of the team. No external adapters.

#### Step 1: Schema and migration
- [ ] Add the `AssignmentBatch` and `AssignmentRecord` models (`database_schema.md` 3.4) with their foreign keys and back-relations
- [ ] `npm run db:migrate:dev -- --name add_assignment_batches`
- [ ] `npm run db:test:migrate` and `npm run db:generate`

#### Step 2: RED tests
- [ ] Unit: 20 leads and 5 agents give 4 each; 22 leads and 5 agents differ by at most one; ineligible agents (inactive, over cap, on leave) are skipped; empty agent list throws `VALIDATION_FAILED`
- [ ] Unit: preview returns the plan without writing anything
- [ ] Integration: MANAGER `POST /api/assignment/bulk` with 20 lead IDs and 5 agents → `200`, database shows 4 leads per agent, 20 audit events exist (the `audit_events` table exists from Phase 1)
- [ ] Integration: AGENT calls it → `403`, body is the generic message and contains no permission code
- [ ] Integration: a lead already assigned → `409` with a friendly message, no partial assignment (transaction rolled back)
- [ ] Integration: the same request submitted twice (same idempotency key) → second call is a no-op
- [ ] Integration: one `assignment.responseTimeout` job is enqueued per lead; `runPendingJobs()` with the clock advanced past the timeout returns an untouched lead to the pool
- [ ] Integration: the new owner receives a `lead.assigned` live-update notice; another agent does not
- [ ] E2E: manager selects leads, chooses Round-robin, sees the preview, confirms, and the queue empties; an agent sees only their own 4 leads
- [ ] Run each tier and confirm the expected failures

#### Step 3: GREEN implementation
- [ ] `assignment.schemas.ts` with friendly messages
- [ ] `assignment.repository.ts` (own tables only)
- [ ] `assignment.service.ts`: eligibility, round-robin planner, preview, transactional apply, event publish, timeout job enqueue, live-update notice
- [ ] `assignment.jobs.ts`: `assignment.responseTimeout` handler (idempotent)
- [ ] `index.ts` public API; controller with `access: { permission: PERMISSIONS.leads.assign }`
- [ ] `src/app/api/assignment/bulk/route.ts`
- [ ] Manager queue UI with preview dialog, using the shared API client

#### Step 4: Verification chain
- [ ] `npm run lint` · `npm run typecheck` · `npm run build` · `npm run build:worker`
- [ ] `npm run test:unit` · `npm run test:integration` · `npm run test:e2e`
- [ ] Manual browser check of sorting, filtering and back-button state on the queue
- [ ] `current_state.md` ticked; decision logged if the planner design changed

---

## Part 6: Infrastructure Work Items

Setup work (CI, Docker, config) is also written in this format, but "RED tests" means tests or checks that prove the capability, for example: a unit test that the env loader refuses a non-test database under `APP_ENV=test`, or a script that fails when a forbidden file is tracked. Write the check first, watch it fail, then add the configuration that makes it pass.

---

## Part 7: Common Mistakes (do not do these)

1. **Writing code before a failing test exists.**
2. **Testing only the happy path.** Forbidden, validation, not-found, conflict and scope tests are required.
3. **Mocking the database in integration tests.** That is a unit test with extra steps.
4. **Using the dev database or real seed in tests.** Tests use `explorehills_test` and `seed-test`.
5. **Putting a permission code, a stack, SQL or a library message in anything the user can see.**
6. **Using `new Date()`, `toLocale*` or the browser's timezone.** Use `src/shared/time/`.
7. **Typing an email, phone number or product name directly in a component.** Use `APP_CONFIG`.
8. **Importing across modules through internals.** Use the public API or an event.
9. **Mock shapes that differ from the real envelope.** Use `ApiResponse<T>`.
10. **Skipping the verification chain or the build step.** The build runs before the tests.
11. **Not updating `current_state.md`** or ticking an item that has not passed its chain.
12. **Declaring a UI item done without opening it in the browser.** Check layout, sorting, filtering, back-button state and smooth scrolling yourself.
13. **Hard-coding `localhost` or ports.** Use `127.0.0.1` and the env loader.
14. **Editing an applied migration** instead of adding a new one.
15. **Leaving a UI item "functionally done" with known visual or logic gaps** to fix later. Fix them inside the item or record them explicitly in `current_state.md` as blocking.
16. **Doing slow or retryable work inside a web request** (webhook processing, downloads, reminders). Enqueue a job.
17. **A job handler that is not idempotent**, or a test that waits on real time instead of advancing the `Clock`.
18. **Naming a calling provider or storage driver outside its folder or registry**, or calling a real provider in a test.
19. **Storing audio or file bytes in the database.**
20. **Checking role names in feature code** (`if role === 'SUPER_ADMIN'`). Only the guard and the scope resolver read the bypass flag.
21. **Starting a phase while a decision it needs is still Open.** Ask the user first.
