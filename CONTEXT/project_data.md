# Project Data: Explore Hills CRM

This document is the project metadata, technical reference, permission dictionary and business-rule reference for the **Explore Hills CRM** platform. Read it first in every session.

> **Last updated 2026-10-29** to match `decision_log.md` Decisions 21–31: single company, cross-module foreign keys, Super Admin and the Roles & Permissions page, browser calling through a provider-agnostic telephony layer, recordings in swappable file storage, background jobs, and live updates.

> **Product name:** "Explore Hills CRM". The product name lives in exactly one place (`APP_CONFIG.product.name` in `src/shared/config/appConfig.ts`). Renaming it there renames it everywhere. See Section 7.

---

## 1. Core Metadata

| Item | Value |
|:---|:---|
| **Project name** | Explore Hills CRM |
| **Purpose** | A lead-assignment CRM. Customers enquire on WhatsApp, a manager distributes the enquiries to agents using routing modes, and agents chat and call (in the browser) from the lead record. Call details and recordings are saved automatically on the lead. |
| **Company** | **Explore Hills** — the only company using the platform. Single-company deployment, no multi-tenancy (Decision 21). |
| **Vertical** | Travel. Pipeline stages and custom fields stay configuration, not code. |
| **Business timezone** | `Asia/Kolkata` (confirmed 2026-10-30, Decision 34; set once in `APP_CONFIG.locale.businessTimezone`) |
| **Architecture** | Modular monolith, Controller → Service → Repository (CSR) inside each module |
| **Stack** | Next.js 16 (App Router), TypeScript (strict), Prisma ORM + migrations, PostgreSQL 16, Zod, Vitest, Playwright, Docker, pg-boss (background jobs), Server-Sent Events (live updates), `ffmpeg-static` (recording compression in the worker), `esbuild` (bundles the worker and the production RBAC-sync tool) |
| **Processes** | `app` (Next.js web server), `worker` (background jobs, Decision 27), `migrate` (one-shot, before every deploy) |
| **Calling** | Browser calling (WebRTC) through a third-party provider behind a provider-agnostic layer (Decision 24). Provider not chosen yet (Decision 30); development and tests use the `fake` provider. |
| **File storage** | Swappable `FileStorage` interface (Decision 26): `local` disk, any S3-compatible service (cloud or self-hosted on a VPS), optional Google Drive. Production target open (Decision 31); development and tests use `local`. |
| **Node version** | 22 LTS or newer (declared in `.nvmrc`, which is the single source for CI and local) |
| **Databases** | `explorehills_dev` (development), `explorehills_test` (tests only), production DB (managed, never touched locally) |
| **Local URLs** | Dev server `http://127.0.0.1:47213`, Docker app `http://127.0.0.1:47214`, E2E server `http://127.0.0.1:47215`, Postgres `127.0.0.1:54329` |
| **Hosting target** | An **always-on** container host or VPS, because the worker and live updates need long-running processes (no serverless). The exact host is decided in Phase 12. |

---

## 2. Product Summary

**People involved**

| Person | What they do in the platform |
|:---|:---|
| **Customer** | Sends a WhatsApp message to the business. Never sees the platform. |
| **Super Admin** | The only role that bypasses every access check. The only one who can create roles and change any role's permissions (including Admin's), and manage Super Admin accounts (Decision 23). |
| **Admin** | Runs the platform day to day: users, settings, templates, reports. A normal role whose permissions the Super Admin sets. |
| **Manager** | Sees the queue of unassigned enquiries, picks an assignment mode, previews who gets what, confirms. Watches the team and reports. |
| **Agent** | Works their own leads: replies on WhatsApp inside the platform, clicks Call and talks **in the browser** with a headset, receives inbound calls as a pop-up, fills the call outcome form. |
| **Calling provider** (external) | Connects the agent's browser call to the customer's phone, records the call, and reports status and the recording back to the platform. |

**Core flow**

1. A WhatsApp enquiry arrives via the Meta WhatsApp Cloud API webhook and becomes a **lead** (duplicates by phone number are merged).
2. The lead appears in the **Manager queue** as `UNASSIGNED`.
3. The manager assigns leads in bulk using a **mode** (Section 3.3) after seeing a preview.
4. The agent works the lead: chat, browser call, notes, trip details, follow-ups. Screens update live (Section 4.5).
5. During a call the lead shows a live call card. When the call ends, the **telephony layer** receives the provider's webhook and writes a call log (status, duration, outcome) onto the lead timeline.
6. A background job downloads the recording, compresses it, and saves it to file storage. Only its storage key and metadata go in the database (Section 3.6).
7. Background jobs handle timeouts, reminders and clean-up (Section 4.4).
8. Reports and dashboards show volume, assignment, response time and conversion.

**Explicitly out of scope for now:** WhatsApp voice calling inside the platform (Decision 18, Phase 13), and running our own media or SIP server. Browser calling **is** in scope, through the provider's WebRTC kit (Decision 24).

---

## 3. Business Domain Rules

### 3.1 Lead Lifecycle

Pipeline stages (travel default): `NEW → CONTACTED → QUALIFIED → QUOTED → WON | LOST`

- **Ownership is separate from the stage.** A lead is *unassigned* while `ownerUserId` is `null` and *assigned* once it has an owner (`database_schema.md` 3.2). Neither is a stage. Every new lead starts in `NEW` and unassigned; the manager queue lists unassigned leads until a manager (or an auto-assign rule) gives them an owner.
- Pipeline stages are configuration, not code, so another vertical can define its own stages. The stage list above is the travel default.
- Every stage change, assignment and reassignment is written to the audit trail with who, when, and why.

### 3.2 WhatsApp Rules

- Inbound messages arrive by webhook. Webhook signatures must be verified before any processing.
- Inbound messages are **idempotent**: the same Meta message ID processed twice creates one record.
- Free-form replies are allowed only inside the 24-hour customer-service window. Outside it, only approved **templates** may be sent. The service layer enforces this, not the UI.
- Message pricing changes quarterly. Never hard-code prices; read them from Meta's current rate card when estimating.
- Customer opt-in must be stored on the contact record. No template is sent to a contact without recorded opt-in.
- Phone numbers are normalised to E.164 on entry and stored in that form only.

### 3.3 Assignment Modes

The manager picks the leads (single, multi-select, or "all unassigned"), a mode, and the eligible agents. The system shows a **preview** of who gets what, and nothing is assigned until the manager confirms.

| Mode | Behaviour |
|:---|:---|
| `MANUAL` | Manager picks the agent for each lead or batch. |
| `ROUND_ROBIN` | Leads are dealt out in rotation; counts differ by at most one. |
| `LEAST_LOADED` | Each lead goes to the eligible agent with the fewest open leads (ties broken by longest idle). |
| `PRIORITY` | Two kinds: agent tiers (senior agents first, up to their cap) and lead value (high-value leads to top agents). |
| `RANDOM` | Shuffled assignment among eligible agents. |
| `BLAST` | Leads go into a shared pool visible to the chosen agents. The first agent to accept owns the lead. |

**Rules that apply to all modes**

- **Eligibility filters:** agent is active, on shift (if shifts are configured), not on leave, under their open-lead cap, and matches any language or destination filter set.
- **Atomic claim (BLAST):** claiming is a single database operation that succeeds for exactly one agent. A second claim on the same lead returns a friendly conflict.
- **Timeout and reassign:** an assigned or claimed lead with no agent action within the configured time returns to the pool or escalates to the manager. The time comes from settings, never hard-coded. Timeouts run as delayed background jobs (Section 4.4).
- **Idempotent bulk assign:** submitting the same bulk request twice must not double-assign.
- **Audit:** every assignment records mode, actor, previous owner, new owner, time, and reason.

### 3.4 Data Visibility (Scoping)

Each user has a role (bundle of permissions) and a place in the team hierarchy (manager → agents). Visibility is decided by three scope permissions:

| Scope permission | Sees |
|:---|:---|
| `*:view-own` | Records assigned to or created by the user |
| `*:view-team` | Own records plus records of agents who report to the user |
| `*:view-all` | Every record |

The service layer resolves the visible agent IDs once (`getVisibleAgentIds(principal)`) and passes them to the repository as a filter. Controllers and repositories never decide scope on their own.

### 3.5 Telephony (Browser Calling via Third-Party Provider)

Full design: `decision_log.md` Decision 24. Provider choice: Decision 30 (open).

**Outbound call flow**
1. The agent clicks **Call** on a lead. The service checks `telephony:call` and scope, creates a `telephony_calls` row with our own `callRef`, and returns short-lived browser credentials from the active provider.
2. The browser `SoftphoneClient` connects and dials through the provider's WebRTC kit. Audio goes between the browser and the provider; the platform carries none.
3. The provider connects to the customer's phone and sends webhooks (ringing, answered, ended, recording ready).
4. The lead shows a live call card (dialling → ringing → connected with timer → ended), driven by softphone events and confirmed by server events over SSE (Section 4.5).
5. After the call the agent fills the outcome form.

**Inbound call flow** (where the provider supports routing by webhook)
- The provider asks our webhook which agent to ring. The lead owner is rung if they are online; otherwise the fallback rule in settings applies. The agent sees an incoming-call pop-up with the lead. Unknown numbers create a new lead in the queue.

**Rules**
- **Two adapter interfaces per provider:** `TelephonyProvider` (server) and `SoftphoneClient` (browser), both in `src/modules/telephony/providers/<key>/`. The active provider comes from `TELEPHONY_PROVIDER`. No code outside that folder names a provider.
- **Capabilities, not names:** services and UI check flags (`browserCalling`, `clickToCall`, `inboundRouting`, `recording`, `dualChannelRecording`, `liveStatusEvents`). If browser calling is unavailable and the provider supports click-to-call, the UI offers "call via my phone".
- **One normalised status set** (`TelephonyCallStatus`); every adapter maps its provider's statuses onto it.
- **Webhooks:** signature verified, raw event stored in `telephony_webhook_events`, processing done by a job (Section 4.4). Processing is **idempotent** (keyed by provider and event ID) and matches the call by our `callRef` first, then by normalised phone number.
- **Agent credentials:** short-lived tokens preferred. Fixed SIP logins, if a provider needs them, are stored encrypted (key from env), sent to the browser only at connect time, never logged, one per agent.
- **Plug and play:** a `fake` provider (server + browser) for development and every test; a shared **contract test suite** every adapter must pass. Adding a provider = new folder + contract suite green + new `TELEPHONY_PROVIDER` value.
- **Agent setup requirements:** HTTPS, microphone permission, headset, and the ports/TURN settings the chosen provider documents.

### 3.6 Call Recordings and File Storage

Full design: `decision_log.md` Decisions 25 and 26. Storage target: Decision 31 (open).

- The provider records the call; callers hear a recording announcement (wording confirmed in Phase 10).
- When the recording is ready, a job downloads it while the provider's link is still valid, converts it to **mono MP3 at about 24 kbps** (about 180 KB per minute; codec and bitrate are settings), and saves it through `FileStorage`.
- **The database stores metadata only:** storage key, size, duration, checksum, recording status. Never audio bytes.
- **Playback** needs `telephony:view-recordings` plus scope. Audio is served through a short-lived signed link where the driver supports it, otherwise streamed by the app after the check. Every playback is audited.
- **Retention:** `retention.recordingDays` (default 180). A scheduled job deletes expired files and clears the key; the call log stays.
- **Failures:** retries with backoff; an expired provider link marks the recording `FAILED` and alerts managers. A recording failure never changes the call log.
- **Storage drivers:** `local` (disk folder; dev, tests, or a single VPS with off-server backups), `s3` (any S3-compatible service: AWS S3, Cloudflare R2, Backblaze B2, Wasabi, or self-hosted on our VPS with Garage, SeaweedFS or MinIO), `gdrive` (optional, later). Chosen by `STORAGE_DRIVER`. Switching is a config change; `npm run storage:copy` moves existing files.
- **Keys** are ours and contain no personal data, e.g. `recordings/2026/12/<callId>.mp3`.

---

## 4. Technical Architecture

### 4.1 Request Path

```
Frontend (React) ↔ API (route.ts) ↔ Controller ↔ Service ↔ Repository ↔ Database
```

| Layer | Lives in | Responsibility | Must NOT |
|:---|:---|:---|:---|
| **Frontend** | `src/app/**/page.tsx`, `src/modules/<m>/ui/` | Screens and user interaction. Talks to the backend only through `src/shared/api/client.ts`. | Import server code, Prisma, or services |
| **API route** | `src/app/api/**/route.ts` | A thin adapter: `export const POST = route({...})`. | Hold logic |
| **Controller** | `src/modules/<m>/<m>.controller.ts` | Access declaration, Zod input parsing, calls the service, shapes the response. | Touch Prisma or repositories |
| **Service** | `src/modules/<m>/<m>.service.ts` | Business rules, scoping, transactions, events. | Import `next/*` or HTTP types |
| **Repository** | `src/modules/<m>/<m>.repository.ts` | Prisma queries. Writes only this module's tables; may read related tables of other modules through relations (Decision 22). | Contain business rules |

### 4.2 Modular Monolith

The whole system is one deployable app, split into **modules** with hard boundaries so the code stays organised and each area can be changed in isolation. Extracting a module into its own service is possible but not planned (Decision 22).

```
src/
├── app/                  # Next.js routes and pages (composition root)
│   └── api/**/route.ts   # thin adapters only
├── modules/
│   └── <module>/
│       ├── <module>.controller.ts
│       ├── <module>.service.ts
│       ├── <module>.repository.ts
│       ├── <module>.schemas.ts     # Zod schemas with user-friendly messages
│       ├── <module>.types.ts
│       ├── <module>.events.ts      # events this module publishes
│       ├── <module>.jobs.ts        # background jobs this module defines (Section 4.4)
│       ├── ui/                     # React components for this module
│       ├── __tests__/              # *.unit.test.ts, *.int.test.ts
│       └── index.ts                # the module's public API (only entry for other modules)
├── shared/               # technical kernel, no business logic
│   ├── config/           # appConfig.ts (single source of truth), env.ts
│   ├── rbac/             # permission registry, principal, guard
│   ├── errors/           # AppError, error catalog, handler wrapper
│   ├── time/             # all date and time handling
│   ├── db/               # Prisma client singleton
│   ├── events/           # in-process typed event bus
│   ├── jobs/             # JobQueue interface, pg-boss implementation, defineJob(), registry type (no module imports)
│   ├── realtime/         # SSE mechanism, Postgres LISTEN/NOTIFY relay, event-type helpers (no module imports)
│   ├── storage/          # FileStorage interface, drivers (local, s3, gdrive), driver registry
│   ├── http/             # route() wrapper, response helpers
│   ├── api/              # frontend API client + friendly error mapper
│   ├── ui/               # shared React components (ErrorMessage, toast, SupportContact)
│   └── logger/
├── instrumentation.ts    # Next.js register(): installs the principal resolver at server start (Decision 39)
├── worker/               # worker process entry point (composition root): collects every module's jobs from their index.ts and starts pg-boss
└── tests/                # cross-cutting tests (architecture, SSOT, security)
```

The telephony module additionally contains `providers/<key>/server.ts` and `providers/<key>/browser.ts` for each calling provider, plus `providers/registry.server.ts` (server-only) and `providers/registry.browser.ts`, so server adapters never reach the browser bundle. The `fake` provider is always present.

**Planned modules**

| Module | Owns |
|:---|:---|
| `system` | Health check, diagnostics (incl. worker heartbeat and failed jobs), system settings (reference implementation, built in Phase 0) |
| `identity` | Users, teams, roles (incl. Super Admin and custom roles), permissions, sessions, the Roles & Permissions page |
| `leads` | Leads, contacts, pipeline stages, notes, tasks, follow-ups |
| `messaging` | WhatsApp inbox, conversations, templates, opt-in |
| `assignment` | Routing modes, queue, claim pool, timeouts, caps |
| `telephony` | Provider adapters (server + browser), softphone UI, call logs, inbound routing, recording download and playback |
| `notifications` | In-app (and later email/push) notifications, reminders |
| `reporting` | Dashboards and exports |
| `audit` | Append-only audit trail (table and writer from Phase 1; views in Phase 10) |

**Boundary rules (enforced by `npm run lint:arch` using dependency-cruiser)**

1. A module may import another module **only through its `index.ts`**.
2. Only `src/app/**` may import a `*.controller.ts`.
3. Only repositories (plus seeds, scripts and `shared/db`) may import Prisma.
4. `src/shared/**` never imports from `src/modules/**` or `src/worker/**`. Module-specific pieces (jobs, live-update event types and their filters) are exported by each module's `index.ts` and assembled in the composition roots: `src/worker/` for jobs, `src/app/` for the event stream.
5. UI code never imports repositories, services, controllers or Prisma.
6. A repository **writes** only its own module's tables. It may **read** another module's tables through Prisma relations for display and reporting (Decision 22). Changing another module's data goes through that module's public API or an event.
7. No circular dependencies.
8. Only `src/modules/telephony/providers/registry.server.ts` and `registry.browser.ts` import a provider folder (the server registry is marked server-only); only `src/shared/storage/registry.ts` imports a storage driver; only `src/shared/jobs/` imports pg-boss. Everything else uses the interfaces.

**Cross-module communication**

- **Synchronous:** call the other module's public service API (in-process function call).
- **Asynchronous:** publish a typed event on the in-process event bus. Events carry plain serialisable data so the bus can be swapped for a message broker when a module is extracted.
- **Cross-module references in the database** are real foreign keys with Prisma `@relation`s (Decision 22, which supersedes Decision 3). Across modules the delete behaviour is `Restrict` by default or `SetNull` with a written reason; never `Cascade`.
- **Background work:** add a job through the `JobQueue` interface (Section 4.4).
- **Telling browsers something changed:** publish a realtime notice (Section 4.5).

### 4.3 API Conventions

- **Success:** `{ "data": <payload> }`. **Error:** `{ "error": { "code": "...", "message": "...", "fieldErrors"?: [...], "requestId": "..." } }`.
- One shared TypeScript type (`ApiResponse<T>`) is used by the server, the frontend client and the tests, so mock shapes cannot drift.
- Instants are ISO-8601 UTC strings ending in `Z`. Business dates are `YYYY-MM-DD` strings (Section 6).
- IDs are opaque strings: UUID v7 (`@default(uuid(7))`, accepted by the Prisma 7 schema engine; confirm in W-007, fall back to cuid2 only if the installed version rejects it).
- Pagination, sorting and filtering follow one shared query contract defined in `src/shared/http/query.ts` in the first phase that needs a list.

### 4.4 Background Jobs (Decision 27)

- **pg-boss** on the existing Postgres (its own schema `pgboss`, not managed by Prisma, ignored by the drift check). No Redis.
- A separate **worker process** (`npm run worker`; `worker` service in Docker) runs the jobs. The web app only enqueues.
- Each module defines its jobs in `<module>.jobs.ts` (name, Zod payload schema, handler, retry policy) and exports them from `index.ts`. The worker entry assembles them. Handlers call the module's service, never Prisma.
- `JobQueue` interface in `src/shared/jobs/`: `enqueue`, `enqueueAt`, `schedule`, `cancel`.
- **Rules:** every handler is idempotent; retries with backoff; final failure raises an alert; recurring jobs use the business timezone; time comes from the injected `Clock`; timeouts use delayed jobs plus a periodic safety sweeper.
- **Webhooks** (WhatsApp, telephony): verify signature → store raw event → enqueue processing → return `200` fast.
- **Health:** worker heartbeat and failed/stuck jobs shown on the diagnostics page.

| Planned job | Module | Trigger |
|:---|:---|:---|
| Assignment response timeout | assignment | Delayed, at `responseDueAt` |
| Blast pool expiry | assignment | Delayed, at `expiresAt` |
| Timeout safety sweeper | assignment | Every few minutes |
| Process WhatsApp webhook event | messaging | On webhook |
| Process telephony webhook event | telephony | On webhook |
| Download and compress recording | telephony | On "recording ready" |
| Recording retention clean-up | telephony | Daily |
| First-response SLA and follow-up reminders | notifications | Delayed / daily (business timezone) |
| Daily report snapshot (only if needed) | reporting | Daily after business midnight |
| Session and webhook-log clean-up | identity, messaging, telephony | Daily |

### 4.5 Live Updates (Decision 28)

- One authenticated **SSE** endpoint, `GET /api/events/stream`; the browser uses `EventSource` (auto-reconnect).
- Events are **notices with IDs**, not data (e.g. `lead.claimed { leadId }`). The browser re-fetches through the normal API, so permission and scope checks stay in one place. The server drops events the user may not see.
- App and worker publish through Postgres `LISTEN/NOTIFY`; each app instance relays to its browsers. Payloads stay small (Postgres limit about 8 KB).
- After a reconnect the page re-fetches its state. If the stream cannot connect, screens poll every few seconds.
- Each module declares its event types (name, ID-only payload schema, receive filter) in `<module>.events.ts`, exported from `index.ts`; the stream route in `src/app/` assembles them. `src/shared/realtime/` holds only the mechanism.
- Uses: blast pool, manager queue, WhatsApp inbox, live call card, incoming-call pop-up, notifications.

### 4.6 Swappable Integrations (the adapter pattern)

Three integrations are deliberately replaceable, each behind one interface, chosen by an environment value, with a `fake`/`local` implementation for development and tests, and a shared contract test suite every implementation must pass:

| Integration | Interface | Chosen by | Dev/test default |
|:---|:---|:---|:---|
| Calling provider | `TelephonyProvider` (server) + `SoftphoneClient` (browser) | `TELEPHONY_PROVIDER` | `fake` |
| File storage | `FileStorage` | `STORAGE_DRIVER` | `local` |
| WhatsApp | `WhatsAppGateway` (Decision 19) | `WHATSAPP_GATEWAY` | `fake` |

---

## 5. RBAC (Role-Based Access Control)

### 5.1 Concepts

| Term | Meaning |
|:---|:---|
| **Permission** | One yes/no right covering exactly one action, written `resource:action` (e.g. `leads:assign`). |
| **Role** | A named bundle of permissions (e.g. `MANAGER`). Roles are stored in the database. The Super Admin creates custom roles and edits bundles on the Roles & Permissions page (Decision 23). |
| **Principal ("identity card")** | The object built for every request: user ID, role, and the full set of permissions the role grants. It is resolved **on the server** per request, so a revoked permission takes effect immediately. |
| **Guard** | The check that runs in front of every action: does the principal's identity card contain the permission this action needs? Default is **deny**. A principal whose role has `bypassesAccess` (only `SUPER_ADMIN`) is always allowed. |
| **Reserved permission** | A registered code that can never be granted to any role; only the Super Admin bypass reaches it (`roles:manage`, `users:manage-super-admins`). |

### 5.2 Rules

1. **Every action sits behind a guard.** Each `route()` declares its access as one of: `{ permission }`, `{ anyOf: [...] }`, `'authenticated'`, or `'public'`. A route without a declaration does not compile. A test scans every `route.ts` to prove this.
2. **Public routes are an allow-list.** Only the routes in `src/shared/rbac/publicRoutes.ts` may be public (health check, login, webhooks that verify their own signature). Adding to the list needs a decision-log entry.
3. **Permission codes come from one registry** (`src/shared/rbac/permissionRegistry.ts`). The guard accepts only registered codes (compile-time safe). Seeds, the guard, and the permission-matrix UI all read this registry.
4. **Scope is a service concern.** The guard answers "may this person do this action at all?". The service then applies own/team/all scope to the data.
5. **Defence in depth.** High-risk actions (assign, reassign, delete, role changes) also call `assertCan(principal, permission)` inside the service.
6. **Permission names are never shown to users.** Denied actions show the generic message from the error catalog. The code is written to the server log only. The catalog scan and the integration tests assert that no permission code appears in any error message or `403` body. The only screen where a code may appear is the Roles & Permissions page, as small secondary text next to the human-readable label, for the Super Admin.
7. **The frontend may hide or disable controls** based on the principal, but the server is always the authority.
8. **Super Admin bypass** is checked in exactly one place (guard and scope resolver) via the role's `bypassesAccess` flag (the identity module also reads the column, as the owner of role data; a scan test enforces this, Decision 38). Feature code never compares role names. Bypass covers access only: business rules, validation and idempotency still apply, and every action is audited.
9. **Reserved permissions** can never be added to a role; the service rejects it and a unit test proves it.
10. **Protections:** the `SUPER_ADMIN` role cannot be edited, renamed or deleted; at least one active Super Admin must always exist (removing the last one fails with `CONFLICT`); an Admin can never edit, deactivate or create a Super Admin.

### 5.3 Default System Roles

| Role | Purpose |
|:---|:---|
| `SUPER_ADMIN` | Bypasses every access check. Only role that manages roles, permissions and Super Admin accounts. Cannot be edited or deleted. |
| `ADMIN` | Default bundle = the `ADMIN` column in 5.4: every non-reserved permission except agent-only actions (such as `leads:claim`): users (never Super Admins), settings, templates, diagnostics, reports. Bundle editable by the Super Admin. |
| `MANAGER` | Sees the team's leads, assigns and reassigns, configures routing, views reports. |
| `AGENT` | Works own leads: chat, call, notes, claim from a pool. |

Default bundles live in `src/shared/rbac/defaultRoles.ts` and are applied by the idempotent `npm run db:sync-rbac` command. The Super Admin changes bundles on the Roles & Permissions page without a code change. The sync never overwrites those edits: it adds new permissions (granting each new one to its default roles), removes deleted ones, and creates missing system roles. "Reset to defaults" on the page re-applies `defaultRoles.ts` for one role (Decision 23).

### 5.4 Permission Catalogue (planned)

Only `system:view-diagnostics` is implemented in Phase 0. Every other permission is added in the phase that introduces its feature, and the phase plan may adjust the defaults below. `SUPER_ADMIN` has no column: it bypasses every check. Columns show the **default** bundles; the Super Admin can change them.

| Permission | Description | ADMIN | MANAGER | AGENT |
|:---|:---|:---|:---|:---|
| `system:view-diagnostics` | View the diagnostics endpoint and page | YES | NO | NO |
| `leads:create` | Create a lead manually | YES | YES | YES |
| `leads:view-own` | View own leads | YES | YES | YES |
| `leads:view-team` | View team leads | YES | YES | NO |
| `leads:view-all` | View all leads | YES | NO | NO |
| `leads:edit` | Edit lead details and stage (within scope) | YES | YES | YES |
| `leads:delete` | Delete a lead | YES | NO | NO |
| `leads:assign` | Assign leads from the queue | YES | YES | NO |
| `leads:reassign` | Move a lead to a different agent | YES | YES | NO |
| `leads:claim` | Claim a lead from a blast pool | NO | NO | YES |
| `assignment:manage-rules` | Configure modes, caps, timeouts, shifts | YES | YES | NO |
| `messaging:view` | View conversations (within scope) | YES | YES | YES |
| `messaging:send` | Send WhatsApp messages | YES | YES | YES |
| `messaging:manage-templates` | Manage message templates | YES | NO | NO |
| `telephony:call` | Place and receive calls from a lead (call logs follow the lead's own/team/all scope) | YES | YES | YES |
| `telephony:view-recordings` | Open call recordings | YES | YES | NO |
| `dashboard:view-own` | Own metrics | YES | YES | YES |
| `dashboard:view-team` | Team metrics | YES | YES | NO |
| `dashboard:view-all` | Company-wide metrics | YES | NO | NO |
| `reports:view` | View reports | YES | YES | NO |
| `reports:export` | Export reports | YES | YES | NO |
| `users:view` / `users:create` / `users:edit` / `users:deactivate` | User management | YES | view only | NO |
| `roles:manage` | Create roles and edit permission bundles (**reserved**: Super Admin only, never grantable) | NO | NO | NO |
| `users:manage-super-admins` | Create, edit or deactivate Super Admins; give the `SUPER_ADMIN` role (**reserved**) | NO | NO | NO |
| `settings:manage` | System settings | YES | NO | NO |
| `audit:view` | View the audit trail | YES | YES | NO |

---

## 6. Time and Date Rules

The database stores instants in UTC, which causes wrong-day bugs around midnight if handled carelessly. These rules apply everywhere.

1. **Two kinds of time values, never mixed.**
   - **Instant** (a moment that happened: message received, call ended, assignment made) → column type `timestamptz`, Prisma `DateTime @db.Timestamptz(3)`. Always UTC in storage and in the API (`...Z`).
   - **Business date** (a calendar day with no time: follow-up date, trip start date) → column type `date`, Prisma `DateTime @db.Date`. Handled as a `YYYY-MM-DD` **string** in the service, API and frontend. It is never converted through a JS `Date` in local time.
2. **One business timezone**, an IANA name (`Asia/Kolkata`), read from `APP_CONFIG.locale.businessTimezone`. Never a fixed offset like `+05:30`.
3. **All date logic lives in `src/shared/time/`.** It wraps a date library (Luxon) and exposes functions such as `now()`, `toBusinessDate(instant)`, `businessDayRange(businessDate)` (returns a half-open UTC range `[start, nextStart)`), `formatInstant(instant, style)`, `parseBusinessLocalDateTime(...)`.
4. **Banned outside `src/shared/time/`** (ESLint rule): `new Date()`, `Date.now()`, `toLocaleDateString`, `toLocaleTimeString`, `getHours`, `getDate`, `getDay`, `getMonth`, `getFullYear`, and friends.
5. **Clock injection.** Services take time from an injectable `Clock`, so tests can freeze time at 23:59 and 00:01 in the business timezone.
6. **"Today", "this week", "overdue" queries** use `businessDayRange` or SQL `col AT TIME ZONE <business tz>`. Daily buckets in reports group on the business-timezone day, never on the UTC day.
7. **Display** is always formatted with an explicit time zone from the time module. Browser-local time is never used implicitly, which also avoids server/client hydration mismatches.
8. **Date inputs:** `<input type="date">` values are sent as the string as-is. Date-time inputs are interpreted in the business timezone and converted to a UTC instant by the time module.
9. **Test matrix:** time-module unit tests run under several `TZ` values (`UTC`, `Asia/Kolkata`, `America/Los_Angeles`, `Pacific/Kiritimati`) to prove the result does not depend on the machine's timezone.
10. **Postgres runs with `timezone = UTC`** in every environment.

---

## 7. Single Source of Truth (SSOT)

A value that is meant to be the same everywhere is defined **once** and referenced everywhere else.

| Value | Lives in | Consumers |
|:---|:---|:---|
| Product name, company legal name, support email, support phone (stored as E.164, display and `tel:` forms are derived), business timezone, locale, currency | `src/shared/config/appConfig.ts` → `APP_CONFIG` | UI, emails, page metadata, error pages, templates, reports |
| Permission codes (incl. reserved list and human-readable labels) | `src/shared/rbac/permissionRegistry.ts` | Guard, seeds, Roles & Permissions page |
| Default role bundles | `src/shared/rbac/defaultRoles.ts` | `db:sync-rbac` |
| User-facing error messages | `src/shared/errors/errorCatalog.ts` | Controllers, frontend |
| Date format styles | `src/shared/time/formats.ts` | Every date display |
| Job names and payload schemas | each module's `<module>.jobs.ts`, exported from its `index.ts`, assembled in `src/worker/` | App (enqueue), worker (run) |
| Realtime event types and receive filters | each module's `<module>.events.ts`, exported from its `index.ts`, assembled by the stream route in `src/app/` | Publishers, SSE stream, browser listeners |
| Calling providers | `src/modules/telephony/providers/registry.server.ts` and `registry.browser.ts` | Telephony service, softphone UI |
| Storage drivers | `src/shared/storage/registry.ts` | Recording jobs, playback, `storage:copy` |
| Default system settings (timeouts, caps, retention) | settings defaults constant used by both seeds | `system_settings` |
| Environment-specific values (DB URL, secrets, ports, hosts) | `.env` files only (never committed except `*.example`) | `src/shared/config/env.ts` (validated, the only reader of `process.env`) |
| Node version | `.nvmrc` | CI, local, Dockerfiles |
| Ports | `.env.example` (`APP_PORT`) | `scripts/run-next.mjs`, Playwright, Docker |

**Enforcement:** a unit test scans `src/` (excluding `appConfig.ts`, tests and fixtures) for email-address and phone-number literals and the company/product name, and fails if it finds any. Documents refer to `APP_CONFIG` instead of repeating the values.

---

## 8. Error Handling Rules

1. **Users only ever see friendly messages.** The frontend never renders a server error string that did not come from the error catalog. No stack traces, SQL, table or column names, library names, permission codes or internal IDs.
2. **Server error shape:** `{ error: { code, message, fieldErrors?, requestId } }`. `message` always comes from the catalog (or a field-level friendly message). `requestId` is an opaque reference the user can quote to support.
3. **Catalog codes (initial):** `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `INTERNAL_ERROR`.
4. **Services throw typed `AppError`s.** Unknown errors (Prisma, network, bugs) are logged in full on the server with the `requestId` and returned as `INTERNAL_ERROR` with a generic message.
5. **Zod messages:** every schema field defines a friendly message. Anything left at a library default is mapped to a generic "Please check this field."
6. **Frontend mapping:** network failure, 401, 403, 404, 429 and 5xx each map to a fixed friendly sentence. Global `error.tsx`, `global-error.tsx` and `not-found.tsx` follow the same rule.
7. **Logs** carry the technical detail (structured, with `requestId`). Secrets and personal data are redacted from logs.

---

## 9. Environments, Files and Ports

| Environment | Env file | Database | Web port | Notes |
|:---|:---|:---|:---|:---|
| Development | `.env` | `explorehills_dev` | `47213` | `npm run dev` |
| Local Docker app | `.env` (+ compose overrides) | `explorehills_dev` | `47214` | Optional full stack in containers |
| Test (unit, integration, e2e) | `.env.test` | `explorehills_test` | `47215` | Isolated from dev data |
| Local worker | `.env` | `explorehills_dev` | none | `npm run worker` (runs background jobs) |
| Production | `.env.production` (never committed) | Managed Postgres | Set per host | Migrations run before `app` and `worker` start |

**Rules**

- Use `127.0.0.1`, never `localhost`, in every URL, to avoid DNS lookup delay and IPv4/IPv6 mismatch.
- Committed example files: `.env.example`, `.env.test.example`, `.env.production.example`. Real `.env*` files are git-ignored.
- When `APP_ENV=test`, startup and test setup refuse to run unless the database name ends in `_test`. When `APP_ENV=production`, they refuse a database name ending in `_test`.
- `next build` must not need a database or secrets. Environment values are validated at runtime, and `NEXT_PUBLIC_*` variables are not used for environment-specific values.
- Development and test default to `TELEPHONY_PROVIDER="fake"`, `STORAGE_DRIVER="local"` and `WHATSAPP_GATEWAY="fake"`, so nothing external is needed to run or test the app. Production refuses `fake` values.
- Secrets for providers and storage (API keys, tokens, the credential-encryption key) live only in env files and the production secret store, never in the database or code.

---

## 10. Testing Strategy (summary)

| Tier | Tool | Scope | Database | Command |
|:---|:---|:---|:---|:---|
| **Unit** | Vitest | Pure logic (services with mocked repositories, time, guard, error mapping, config, architecture and SSOT scans, UI components) | None | `npm run test:unit` |
| **Integration** | Vitest (node) | Route handler → controller → service → repository → real Postgres | `explorehills_test` | `npm run test:integration` |
| **E2E** | Playwright | Real browser against the **built** app started with `.env.test` | `explorehills_test` | `npm run test:e2e` |

- **Build before tests.** `npm run ci:quality` runs `lint → typecheck → build → build:worker → unit → integration → e2e`, in that order.
- Integration tests never mock Prisma. Unit tests may mock repositories only.
- Test data comes from `prisma/seed-test.ts`, which refuses to run against any non-test database. Production seed data is never used in tests.
- **Test-first is mandatory** for the risky core (Decision 29): assignment engine and modes, blast-claim concurrency, timeouts and jobs, webhook idempotency, RBAC guard/bypass/scope, the time module, and the adapter contract suites.
- **E2E covers only the 8 critical journeys** listed in Decision 29.
- **Adapters:** every telephony provider, storage driver and WhatsApp gateway passes its shared contract suite. Tests use `fake`/`local` only; no test calls a real provider.
- **Jobs:** unit tests call handlers directly; integration tests drain real queues on the test DB with `runPendingJobs()`; time is advanced through the `Clock`, never waited for.
- Full checklist rules are in `TDD_INSTRUCTION_GUIDE.md`.

---

## 11. Open Questions (to resolve before the phase that needs them)

| Question | Needed by |
|:---|:---|
| Direct Meta Cloud API integration or through a WhatsApp provider (BSP)? (Decision 19) | Phase 4 |
| Do agents need SMS as well as WhatsApp, or WhatsApp only? | Phase 4 |
| Which calling provider? Use the comparison checklist in Decision 30, including browser calling to Indian numbers and DoT/TRAI compliance. | Before the first real adapter in Phase 7 |
| Where are recordings stored in production (S3 cloud, self-hosted S3 on the VPS, local disk, Google Drive)? (Decision 31) | Before production go-live |
| Recording announcement wording and DPDP consent/notice | Phase 10 |
| Company legal name, support email and phone (product name is Explore Hills CRM) | Before first production release |
| Hosting target (must be always-on: worker + live updates) | Phase 12 |

**Resolved:** single company vs multi-tenant → single company, Explore Hills (Decision 21, 2026-10-29).
**Resolved:** authentication → own sessions table, 12-hour sliding sessions capped at 7 days, 15-minute lock after 5 wrong passwords (Decisions 20 and 46, 2026-10-30).
