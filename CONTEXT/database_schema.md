# Database Schema: Explore Hills CRM

This document is the authoritative **target** schema for Explore Hills CRM: every table, column type, index and ownership rule, plus the seed plan and shared constants. It is written for PostgreSQL 16 and Prisma.

> **Status of this document**
> - **Last updated 2026-10-29** to match `decision_log.md` Decisions 21–31.
> - **Phase 0 implements** the `identity` RBAC tables (`identity_permissions`, `identity_roles`, `identity_role_permissions`) and `system_worker_heartbeats`.
> - Every other table is **planned**. Each phase's detailed plan (written with `TDD_INSTRUCTION_GUIDE.md`) may adjust its tables, and must update this file in the same change.
> - One open decision affects the schema: **Decision 20** (authentication approach, affects `identity_sessions`). Resolve it in the Phase 1 plan.
> - **Tenancy is resolved:** single company, Explore Hills (Decision 21). No `tenant` table and no `tenantId` column anywhere.
> - **Background jobs:** pg-boss creates and manages its own tables in the Postgres schema `pgboss` (Decision 27). They are not in `schema.prisma` or in this document, and Prisma's drift check ignores them.

---

## 1. Conventions (apply to every table)

| Convention | Rule |
|:---|:---|
| **Table names** | `<module>_<plural_noun>` via `@@map` (e.g. `leads_leads`, `identity_users`). Prisma model names are `PascalCase` with the module prefix (e.g. `LeadsLead`). |
| **Ownership** | Every table belongs to exactly one module. A repository **writes** only its own module's tables; it may **read** other modules' tables through Prisma relations (Decision 22). |
| **Cross-module references** | Real **foreign keys** with Prisma `@relation`s (Decision 22, supersedes Decision 3), marked `// → <module>.<table>` in the schema. Every cross-module relation sets `onDelete` explicitly: `Restrict` by default, `SetNull` only with a comment giving the reason. `Cascade` is allowed only **inside** a module. Prisma needs the matching back-relation field on the other model; it is added in the same change and creates no SQL column. |
| **Polymorphic references** | `leads_timeline_entries.refType/refId` and `audit_events.entityType/entityId` can point at many different tables, so they stay **plain IDs without a foreign key**, by design. |
| **Large binary data** | Never stored in the database. Audio and other files go to `FileStorage` (Decision 26); the database holds the storage key and metadata only. |
| **Encrypted columns** | Column names end in `Encrypted`. Encrypted in the application (AES-256-GCM, key from `CREDENTIALS_ENCRYPTION_KEY`), never logged, never returned by any API. |
| **Database schemas** | Application tables live in `public` and are managed by Prisma. pg-boss uses its own `pgboss` schema, which Prisma does not manage. |
| **Primary keys** | `String @id @default(uuid(7)) @db.Uuid` (time-ordered UUID v7). Accepted by the Prisma 7 schema engine (checked 2026-10-29); confirm in W-007, and only if the installed version rejects it use `cuid2` and update this file. |
| **Instants** (a moment that happened) | `DateTime @db.Timestamptz(3)`. Stored UTC. Named `...At` (`createdAt`, `answeredAt`). |
| **Business dates** (a calendar day) | `DateTime @db.Date`. Handled as `YYYY-MM-DD` strings in code. Named `...Date` (`nextFollowUpDate`, `travelStartDate`). |
| **Time-of-day** | Integer minutes from midnight in the business timezone (e.g. 09:30 → `570`). Never a `DateTime`. |
| **Timestamps** | Every table has `createdAt`; mutable tables also have `updatedAt @updatedAt`. |
| **Phone numbers** | `phoneE164`, stored normalised to E.164 (`+<country><number>`) only. A SQL `CHECK` constraint in the migration enforces `^\+[1-9][0-9]{6,14}$`. |
| **Emails** | Stored lowercase; uniqueness enforced on the lowercase value (normalise in the service). |
| **Money** | `Decimal @db.Decimal(12, 2)`. Currency comes from `APP_CONFIG`, not a per-row column, until multi-currency is required. |
| **Enums** | Prisma enums prefixed by module (e.g. `LeadsSource`). Each has a matching `as const` array in the owning module's `*.types.ts`, and a unit test asserts the two stay identical (Section 8). |
| **Flexible data** | `Json` columns only for configuration and vertical-specific custom fields, never for data that is queried or filtered often. |
| **Soft delete** | `deletedAt` only on `leads_leads` and `leads_contacts`. Erasure requests anonymise personal fields (Section 7) instead of removing rows that other records point to. **Users are never hard-deleted**; they are deactivated (`status = DEACTIVATED`). The cross-module `Restrict` foreign keys rely on this. |
| **Append-only tables** | `audit_events` (and webhook event logs) are never updated or deleted by the application. Enforce in the migration with revoked `UPDATE`/`DELETE` privileges or a trigger. |
| **Partial indexes** | Prisma cannot express them. Add them as raw SQL inside the migration and list them in Section 6. |
| **Migrations** | Every change is a named migration (Decision 12), backward compatible with the previous app version. Update this file in the same pull request. |

---

## 2. Module Ownership and Cross-Module Foreign Keys

```
identity ──────┐  users, teams, roles, permissions, sessions
               │
leads ─────────┤  contacts, leads, pipeline stages, notes, tasks, timeline
               │
messaging ─────┤  conversations, messages, templates, webhook log
               │
assignment ────┤  agent settings, shifts, rules, batches, records, pool, pool eligibility
               │
telephony ─────┤  provider accounts, agent endpoints, calls, recordings, webhook log
               │
notifications ─┤  in-app notifications            (Phase 8)
reporting ─────┤  daily snapshots                 (Phase 9)
audit ─────────┤  append-only audit events        (table and writer Phase 1; views Phase 10)
system ────────┘  settings, worker heartbeats
```

**Cross-module foreign keys** (Decision 22). Users are never hard-deleted, so `Restrict` towards `identity_users` never blocks normal work.

| Column | Points to | `onDelete` | Reason / note |
|:---|:---|:---|:---|
| `leads_leads.ownerUserId` | `identity_users.id` | Restrict | `null` = unassigned. Written by `assignment` through the `leads` public API. |
| `leads_notes.authorUserId`, `leads_tasks.assigneeUserId`, `leads_timeline_entries.actorUserId` | `identity_users.id` | Restrict | |
| `messaging_conversations.contactId` | `leads_contacts.id` | Restrict | Contacts are anonymised, not deleted. |
| `messaging_conversations.leadId` | `leads_leads.id` | SetNull | The conversation outlives a merged or erased lead. |
| `messaging_conversations.ownerUserId` | `identity_users.id` | SetNull | Denormalised copy of the lead owner for fast inbox filtering; kept in sync by the `lead.assigned` event. |
| `messaging_messages.sentByUserId` | `identity_users.id` | Restrict | `null` for inbound messages. |
| `assignment_agent_settings.userId`, `assignment_rules.createdByUserId`, `assignment_batches.requestedByUserId` | `identity_users.id` | Restrict | |
| `assignment_records.leadId` | `leads_leads.id` | Restrict | |
| `assignment_records.fromUserId`, `.toUserId` | `identity_users.id` | Restrict | |
| `assignment_pool_entries.leadId` | `leads_leads.id` | Restrict | |
| `assignment_pool_entries.claimedByUserId`, `assignment_pool_eligibility.userId` | `identity_users.id` | Restrict | |
| `telephony_agent_endpoints.userId` | `identity_users.id` | Restrict | |
| `telephony_calls.leadId` | `leads_leads.id` | Restrict | Leads are soft-deleted, so call history keeps its lead. |
| `telephony_calls.agentUserId` | `identity_users.id` | Restrict | `null` for an inbound call nobody answered. |
| `system_settings.updatedByUserId` | `identity_users.id` | Restrict | |
| `notifications_notifications.userId` | `identity_users.id` | Restrict | |
| `audit_events.actorUserId` | `identity_users.id` | Restrict | `null` for system actions (jobs, webhooks). |

**Not foreign keys (by design):** `leads_timeline_entries.refType/refId`, `audit_events.entityType/entityId` (polymorphic), and `reporting_daily_snapshots.scopeKey`.

---

## 3. Prisma Schema

> Generator and datasource blocks are created in W-007; the generator emits a CommonJS client (`moduleFormat = "cjs"`, Decision 38). **Each phase adds only its own models and fields**: a relation or back-relation marked with a later phase is left out until that phase, so the schema validates at every step. The models below use the conventions in Section 1. `// → module.table` marks a cross-module foreign key. **Back-relation fields** (lists on the "one" side) are required by Prisma; each is added in the same phase as the relation it mirrors, and creates no SQL column.

### 3.1 `identity` module

```prisma
enum IdentityUserStatus {
  INVITED
  ACTIVE
  DEACTIVATED
}

// PHASE 0 — implemented
model IdentityPermission {
  id          String   @id @default(uuid(7)) @db.Uuid
  code        String   @unique              // e.g. "leads:assign" (from permissionRegistry.ts)
  label       String                        // human-readable name shown on the Roles & Permissions page
  description String
  module      String                        // owning module, for grouping on the Roles & Permissions page
  isReserved  Boolean  @default(false)      // reserved codes can never be granted to any role (Decision 23)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  roles       IdentityRolePermission[]

  @@map("identity_permissions")
}

// PHASE 0 — implemented
model IdentityRole {
  id             String   @id @default(uuid(7)) @db.Uuid
  code           String   @unique           // SUPER_ADMIN, ADMIN, MANAGER, AGENT, or a custom code
  name           String
  description    String?
  isSystem       Boolean  @default(false)   // system roles cannot be deleted
  bypassesAccess Boolean  @default(false)   // true only for SUPER_ADMIN; at most one row (Section 6)
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt @db.Timestamptz(3)
  permissions    IdentityRolePermission[]   // SUPER_ADMIN holds none: it bypasses every check
  users          IdentityUser[]             // Phase 1

  @@map("identity_roles")
}

// PHASE 0 — implemented
model IdentityRolePermission {
  roleId       String             @db.Uuid
  permissionId String             @db.Uuid
  role         IdentityRole       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   IdentityPermission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
  @@map("identity_role_permissions")
}

// PHASE 1
model IdentityUser {
  id               String             @id @default(uuid(7)) @db.Uuid
  email            String             @unique       // stored lowercase
  name             String
  phoneE164        String?
  passwordHash     String                            // never returned by any API
  status           IdentityUserStatus @default(INVITED)
  roleId           String             @db.Uuid
  role             IdentityRole       @relation(fields: [roleId], references: [id], onDelete: Restrict) // a role still held by users cannot be deleted
  // Hierarchy and teams: PHASE 2
  managerId        String?            @db.Uuid       // reporting line
  manager          IdentityUser?      @relation("UserManager", fields: [managerId], references: [id], onDelete: Restrict)
  reports          IdentityUser[]     @relation("UserManager")
  teamId           String?            @db.Uuid
  team             IdentityTeam?      @relation("TeamMembers", fields: [teamId], references: [id], onDelete: SetNull)
  managedTeams     IdentityTeam[]     @relation("TeamManager")
  sessions         IdentitySession[]
  failedLoginCount Int                @default(0)
  lockedUntil      DateTime?          @db.Timestamptz(3)
  lastLoginAt      DateTime?          @db.Timestamptz(3)
  createdAt        DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime           @updatedAt @db.Timestamptz(3)
  deactivatedAt    DateTime?          @db.Timestamptz(3)

  // Back-relations from other modules (Decision 22). Each is added in the phase that adds the other side.
  ownedLeads         LeadsLead[]                     // Phase 3
  leadNotes          LeadsNote[]                     // Phase 3
  leadTasks          LeadsTask[]                     // Phase 3
  timelineEntries    LeadsTimelineEntry[]            // Phase 3
  updatedSettings    SystemSetting[]                 // Phase 3
  ownedConversations MessagingConversation[]         // Phase 4
  sentMessages       MessagingMessage[]              // Phase 4
  assignmentSetting  AssignmentAgentSetting?         // Phase 5
  createdRules       AssignmentRule[]                // Phase 5
  requestedBatches   AssignmentBatch[]               // Phase 5
  assignmentsFrom    AssignmentRecord[]  @relation("AssignmentFrom") // Phase 5
  assignmentsTo      AssignmentRecord[]  @relation("AssignmentTo")   // Phase 5
  claimedPoolEntries AssignmentPoolEntry[]           // Phase 5
  poolEligibility    AssignmentPoolEligibility[]     // Phase 5
  telephonyEndpoints TelephonyAgentEndpoint[]        // Phase 7
  calls              TelephonyCall[]                 // Phase 7
  notifications      NotificationsNotification[]     // Phase 8
  auditEvents        AuditEvent[]                    // Phase 1

  @@index([roleId])
  @@index([managerId])
  @@index([teamId])
  @@index([status])
  @@map("identity_users")
}

// PHASE 2
model IdentityTeam {
  id            String         @id @default(uuid(7)) @db.Uuid
  name          String         @unique
  managerUserId String?        @db.Uuid
  manager       IdentityUser?  @relation("TeamManager", fields: [managerUserId], references: [id], onDelete: Restrict)
  members       IdentityUser[] @relation("TeamMembers")
  createdAt     DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime       @updatedAt @db.Timestamptz(3)

  @@map("identity_teams")
}

// PHASE 1 — shape depends on Decision 20 (authentication approach)
model IdentitySession {
  id         String       @id @default(uuid(7)) @db.Uuid
  userId     String       @db.Uuid
  user       IdentityUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String       @unique                    // hash of the session token; the raw token is never stored
  expiresAt  DateTime     @db.Timestamptz(3)
  lastSeenAt DateTime     @db.Timestamptz(3)
  revokedAt  DateTime?    @db.Timestamptz(3)
  ip         String?
  userAgent  String?
  createdAt  DateTime     @default(now()) @db.Timestamptz(3)

  @@index([userId])
  @@index([expiresAt])
  @@map("identity_sessions")
}
```

### 3.2 `leads` module

> **Unassigned is not a pipeline stage.** A lead is unassigned when `ownerUserId` is `null`. Its stage (for example `NEW`) is independent of whether it has an owner. The manager queue lists leads with `ownerUserId = null`.

```prisma
enum LeadsSource {
  WHATSAPP
  PHONE        // created from an inbound call from an unknown number
  MANUAL
  WEBSITE
  AD
  IMPORT
}

enum LeadsStageKind {
  OPEN
  WON
  LOST
}

enum LeadsOptInStatus {
  UNKNOWN
  OPTED_IN
  OPTED_OUT
}

enum LeadsTimelineKind {
  LEAD_CREATED
  STAGE_CHANGED
  ASSIGNED
  NOTE
  MESSAGE
  CALL
  TASK
}

// PHASE 3 — the stage list is configuration (seeded with the travel default)
model LeadsPipelineStage {
  id        String         @id @default(uuid(7)) @db.Uuid
  code      String         @unique                  // NEW, CONTACTED, QUALIFIED, QUOTED, WON, LOST ...
  name      String
  position  Int                                     // display and funnel order
  kind      LeadsStageKind @default(OPEN)
  isActive  Boolean        @default(true)
  createdAt DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt DateTime       @updatedAt @db.Timestamptz(3)
  leads     LeadsLead[]

  @@index([position])
  @@map("leads_pipeline_stages")
}

// PHASE 3 — PII
model LeadsContact {
  id            String                  @id @default(uuid(7)) @db.Uuid
  phoneE164     String                  @unique                // the duplicate-merge key
  name          String?
  email         String?
  optInStatus   LeadsOptInStatus        @default(UNKNOWN)      // WhatsApp template opt-in (project_data.md 3.2)
  optInAt       DateTime?               @db.Timestamptz(3)
  optInSource   String?                                        // e.g. "whatsapp_inbound", "web_form"
  anonymisedAt  DateTime?               @db.Timestamptz(3)
  createdAt     DateTime                @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime                @updatedAt @db.Timestamptz(3)
  deletedAt     DateTime?               @db.Timestamptz(3)
  leads         LeadsLead[]
  conversations MessagingConversation[]                        // back-relation, Phase 4

  @@map("leads_contacts")
}

// PHASE 3
model LeadsLead {
  id                String               @id @default(uuid(7)) @db.Uuid
  contactId         String               @db.Uuid
  contact           LeadsContact         @relation(fields: [contactId], references: [id], onDelete: Restrict)
  source            LeadsSource          @default(WHATSAPP)
  sourceDetail      String?                                // campaign or ad name
  stageId           String               @db.Uuid
  stage             LeadsPipelineStage   @relation(fields: [stageId], references: [id], onDelete: Restrict)
  ownerUserId       String?              @db.Uuid          // → identity.identity_users (null = unassigned)
  owner             IdentityUser?        @relation(fields: [ownerUserId], references: [id], onDelete: Restrict)
  assignedAt        DateTime?            @db.Timestamptz(3)
  priorityScore     Int                  @default(0)       // used by PRIORITY mode
  // Travel fields (extra fields live in customFields)
  destination       String?
  travelStartDate   DateTime?            @db.Date          // business date
  travelEndDate     DateTime?            @db.Date          // business date
  travellerCount    Int?
  budgetAmount      Decimal?             @db.Decimal(12, 2)
  customFields      Json                 @default("{}")
  // Activity tracking
  firstResponseAt   DateTime?            @db.Timestamptz(3)
  lastActivityAt    DateTime?            @db.Timestamptz(3)
  nextFollowUpDate  DateTime?            @db.Date          // business date
  closedAt          DateTime?            @db.Timestamptz(3)
  lostReason        String?
  createdAt         DateTime             @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime             @updatedAt @db.Timestamptz(3)
  deletedAt         DateTime?            @db.Timestamptz(3)
  notes             LeadsNote[]
  tasks             LeadsTask[]
  timeline          LeadsTimelineEntry[]
  // Back-relations from other modules
  conversations     MessagingConversation[]   // Phase 4
  assignmentRecords AssignmentRecord[]        // Phase 5
  poolEntries       AssignmentPoolEntry[]     // Phase 5
  calls             TelephonyCall[]           // Phase 7

  @@index([ownerUserId, stageId])
  @@index([stageId])
  @@index([ownerUserId, createdAt])                    // unassigned queue and "my leads"
  @@index([nextFollowUpDate])
  @@index([createdAt])
  @@index([contactId])
  @@index([deletedAt])
  @@map("leads_leads")
}

// PHASE 3
model LeadsNote {
  id           String       @id @default(uuid(7)) @db.Uuid
  leadId       String       @db.Uuid
  lead         LeadsLead    @relation(fields: [leadId], references: [id], onDelete: Cascade)
  authorUserId String       @db.Uuid                    // → identity.identity_users
  author       IdentityUser @relation(fields: [authorUserId], references: [id], onDelete: Restrict)
  body         String
  createdAt    DateTime     @default(now()) @db.Timestamptz(3)

  @@index([leadId, createdAt])
  @@index([authorUserId])
  @@map("leads_notes")
}

// PHASE 3
model LeadsTask {
  id             String       @id @default(uuid(7)) @db.Uuid
  leadId         String       @db.Uuid
  lead           LeadsLead    @relation(fields: [leadId], references: [id], onDelete: Cascade)
  assigneeUserId String       @db.Uuid                  // → identity.identity_users
  assignee       IdentityUser @relation(fields: [assigneeUserId], references: [id], onDelete: Restrict)
  title          String
  dueDate        DateTime     @db.Date                  // business date
  completedAt    DateTime?    @db.Timestamptz(3)
  createdAt      DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime     @updatedAt @db.Timestamptz(3)

  @@index([assigneeUserId, dueDate])
  @@index([leadId])
  @@map("leads_tasks")
}

// PHASE 3 — a read model built from events (messages, calls, assignments) so the lead page loads one timeline
model LeadsTimelineEntry {
  id          String            @id @default(uuid(7)) @db.Uuid
  leadId      String            @db.Uuid
  lead        LeadsLead         @relation(fields: [leadId], references: [id], onDelete: Cascade)
  kind        LeadsTimelineKind
  summary     String                                    // short human-readable text
  refType     String?                                   // "message", "call", "assignment_record" ... (polymorphic: no FK)
  refId       String?                                   // id in the owning module (polymorphic: no FK)
  actorUserId String?           @db.Uuid                // → identity.identity_users
  actor       IdentityUser?     @relation(fields: [actorUserId], references: [id], onDelete: Restrict)
  occurredAt  DateTime          @db.Timestamptz(3)
  createdAt   DateTime          @default(now()) @db.Timestamptz(3)

  @@index([leadId, occurredAt])
  @@unique([refType, refId, kind])                       // makes event handling idempotent
  @@map("leads_timeline_entries")
}
```

### 3.3 `messaging` module (Phase 4)

```prisma
enum MessagingDirection {
  INBOUND
  OUTBOUND
}

enum MessagingMessageType {
  TEXT
  IMAGE
  DOCUMENT
  AUDIO
  VIDEO
  TEMPLATE
  INTERACTIVE
  UNSUPPORTED
}

enum MessagingMessageStatus {
  QUEUED
  SENT
  DELIVERED
  READ
  FAILED
  RECEIVED
}

enum MessagingTemplateCategory {
  UTILITY
  MARKETING
  AUTHENTICATION
}

// PII
model MessagingConversation {
  id                    String             @id @default(uuid(7)) @db.Uuid
  businessPhoneNumberId String                                // the WhatsApp business number this chat belongs to
  waId                  String                                // the customer's WhatsApp ID
  contactId             String             @db.Uuid           // → leads.leads_contacts
  contact               LeadsContact       @relation(fields: [contactId], references: [id], onDelete: Restrict)
  leadId                String?            @db.Uuid           // → leads.leads_leads
  lead                  LeadsLead?         @relation(fields: [leadId], references: [id], onDelete: SetNull)   // the conversation outlives a merged or erased lead
  ownerUserId           String?            @db.Uuid           // → identity.identity_users
  owner                 IdentityUser?      @relation(fields: [ownerUserId], references: [id], onDelete: SetNull) // denormalised lead owner for inbox filtering; synced by the lead.assigned event
  lastInboundAt         DateTime?          @db.Timestamptz(3) // the 24-hour window starts here (computed in the service)
  lastMessageAt         DateTime?          @db.Timestamptz(3)
  unreadCount           Int                @default(0)
  createdAt             DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime           @updatedAt @db.Timestamptz(3)
  messages              MessagingMessage[]

  @@unique([businessPhoneNumberId, waId])
  @@index([ownerUserId, lastMessageAt])
  @@index([leadId])
  @@index([contactId])
  @@map("messaging_conversations")
}

// PII
model MessagingMessage {
  id             String                 @id @default(uuid(7)) @db.Uuid
  conversationId String                 @db.Uuid
  conversation   MessagingConversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction      MessagingDirection
  type           MessagingMessageType
  waMessageId    String?                @unique                 // Meta's message ID: webhook idempotency
  clientRef      String?                @unique                 // our idempotency key for outbound sends
  body           String?
  mediaRef       String?                                         // provider media ID or our FileStorage key
  templateName   String?
  status         MessagingMessageStatus
  failureCode    String?                                         // internal; never shown to users
  sentByUserId   String?                @db.Uuid                 // → identity.identity_users (null for inbound)
  sentBy         IdentityUser?          @relation(fields: [sentByUserId], references: [id], onDelete: Restrict)
  occurredAt     DateTime               @db.Timestamptz(3)       // when it was sent/received (provider time)
  deliveredAt    DateTime?              @db.Timestamptz(3)
  readAt         DateTime?              @db.Timestamptz(3)
  createdAt      DateTime               @default(now()) @db.Timestamptz(3)

  @@index([conversationId, occurredAt])
  @@index([sentByUserId])
  @@map("messaging_messages")
}

model MessagingTemplate {
  id             String                    @id @default(uuid(7)) @db.Uuid
  name           String
  language       String
  category       MessagingTemplateCategory
  status         String                                           // provider approval status, e.g. APPROVED, REJECTED
  body           String
  variables      Json                      @default("[]")
  providerRef    String?
  createdAt      DateTime                  @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime                  @updatedAt @db.Timestamptz(3)

  @@unique([name, language])
  @@map("messaging_templates")
}

// Append-only log of raw webhook deliveries; processing runs as a background job (Decision 27)
model MessagingWebhookEvent {
  id          String    @id @default(uuid(7)) @db.Uuid
  eventKey    String    @unique                                  // provider message/status ID + type
  payload     Json
  receivedAt  DateTime  @default(now()) @db.Timestamptz(3)
  processedAt DateTime? @db.Timestamptz(3)
  error       String?                                            // internal text, never shown to users

  @@index([receivedAt])
  @@map("messaging_webhook_events")
}
```

### 3.4 `assignment` module (Phase 5)

```prisma
enum AssignmentMode {
  MANUAL
  ROUND_ROBIN
  LEAST_LOADED
  PRIORITY
  RANDOM
  BLAST
}

enum AssignmentBatchStatus {
  COMMITTED
  FAILED
}

enum AssignmentPoolStatus {
  OPEN
  CLAIMED
  EXPIRED
  CANCELLED
}

// Per-agent routing settings
model AssignmentAgentSetting {
  id            String            @id @default(uuid(7)) @db.Uuid
  userId        String            @unique @db.Uuid               // → identity.identity_users
  user          IdentityUser      @relation(fields: [userId], references: [id], onDelete: Restrict)
  isAvailable   Boolean           @default(true)
  openLeadCap   Int?                                              // null = use the system default
  priorityTier  Int               @default(0)                     // higher = served first in PRIORITY mode
  languages     String[]
  destinations  String[]
  leaveFromDate DateTime?         @db.Date                        // business date
  leaveToDate   DateTime?         @db.Date                        // business date
  createdAt     DateTime          @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime          @updatedAt @db.Timestamptz(3)
  shifts        AssignmentShift[]

  @@map("assignment_agent_settings")
}

model AssignmentShift {
  id          String                 @id @default(uuid(7)) @db.Uuid
  settingId   String                 @db.Uuid
  setting     AssignmentAgentSetting @relation(fields: [settingId], references: [id], onDelete: Cascade)
  weekday     Int                                                  // 0 = Sunday ... 6 = Saturday, in the business timezone
  startMinute Int                                                  // minutes from midnight, business timezone
  endMinute   Int

  @@unique([settingId, weekday, startMinute])
  @@map("assignment_shifts")
}

// Saved routing configurations, including the optional auto-assign default
model AssignmentRule {
  id              String         @id @default(uuid(7)) @db.Uuid
  name            String         @unique
  mode            AssignmentMode
  config          Json           @default("{}")                    // eligible agents, filters, tiers
  isAutoAssign    Boolean        @default(false)                   // apply automatically to new leads
  isActive        Boolean        @default(true)
  createdByUserId String         @db.Uuid                          // → identity.identity_users
  createdBy       IdentityUser   @relation(fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime       @updatedAt @db.Timestamptz(3)

  @@map("assignment_rules")
}

// One manager confirmation = one batch
model AssignmentBatch {
  id                String                @id @default(uuid(7)) @db.Uuid
  idempotencyKey    String                @unique                  // same request twice = no second assignment
  mode              AssignmentMode
  requestedByUserId String                @db.Uuid                 // → identity.identity_users
  requestedBy       IdentityUser          @relation(fields: [requestedByUserId], references: [id], onDelete: Restrict)
  status            AssignmentBatchStatus
  leadCount         Int
  config            Json                  @default("{}")
  createdAt         DateTime              @default(now()) @db.Timestamptz(3)
  records           AssignmentRecord[]

  @@index([createdAt])
  @@map("assignment_batches")
}

// Domain history of ownership changes (audit events are published in addition)
model AssignmentRecord {
  id            String           @id @default(uuid(7)) @db.Uuid
  batchId       String?          @db.Uuid
  batch         AssignmentBatch? @relation(fields: [batchId], references: [id], onDelete: Restrict)
  leadId        String           @db.Uuid                         // → leads.leads_leads
  lead          LeadsLead        @relation(fields: [leadId], references: [id], onDelete: Restrict)
  fromUserId    String?          @db.Uuid                         // → identity.identity_users
  fromUser      IdentityUser?    @relation("AssignmentFrom", fields: [fromUserId], references: [id], onDelete: Restrict)
  toUserId      String           @db.Uuid                         // → identity.identity_users
  toUser        IdentityUser     @relation("AssignmentTo", fields: [toUserId], references: [id], onDelete: Restrict)
  mode          AssignmentMode
  reason        String?
  responseDueAt DateTime?        @db.Timestamptz(3)               // timeout deadline; a delayed job fires here (Decision 27)
  respondedAt   DateTime?        @db.Timestamptz(3)
  createdAt     DateTime         @default(now()) @db.Timestamptz(3)

  @@index([leadId, createdAt])
  @@index([toUserId, createdAt])
  @@index([responseDueAt])
  @@map("assignment_records")
}

// BLAST pool: a lead offered to several agents; the first claim wins
model AssignmentPoolEntry {
  id              String                      @id @default(uuid(7)) @db.Uuid
  leadId          String                      @db.Uuid             // → leads.leads_leads
  lead            LeadsLead                   @relation(fields: [leadId], references: [id], onDelete: Restrict)
  status          AssignmentPoolStatus        @default(OPEN)
  claimedByUserId String?                     @db.Uuid             // → identity.identity_users
  claimedBy       IdentityUser?               @relation(fields: [claimedByUserId], references: [id], onDelete: Restrict)
  claimedAt       DateTime?                   @db.Timestamptz(3)
  expiresAt       DateTime                    @db.Timestamptz(3)   // a delayed job expires the entry here
  createdAt       DateTime                    @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime                    @updatedAt @db.Timestamptz(3)
  eligibleUsers   AssignmentPoolEligibility[]

  @@index([status, expiresAt])
  @@index([leadId])
  @@map("assignment_pool_entries")
}

// Which agents may see and claim a pool entry (a join table, so each user ID is a real foreign key)
model AssignmentPoolEligibility {
  poolEntryId String              @db.Uuid
  poolEntry   AssignmentPoolEntry @relation(fields: [poolEntryId], references: [id], onDelete: Cascade)
  userId      String              @db.Uuid                         // → identity.identity_users
  user        IdentityUser        @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@id([poolEntryId, userId])
  @@index([userId])                                                // "my open pool" query
  @@map("assignment_pool_eligibility")
}
```

### 3.5 `telephony` module (Phase 7)

> Browser calling through a provider-agnostic layer (Decision 24). Recordings are copied into our own storage (Decisions 25 and 26). No audio is ever stored in the database.

```prisma
enum TelephonyDirection {
  OUTBOUND
  INBOUND
}

enum TelephonyChannel {
  BROWSER      // the agent talks in the browser through the provider's WebRTC kit (default)
  PHONE        // fallback: provider rings the agent's phone (click-to-call)
}

enum TelephonyCallStatus {
  INITIATED
  RINGING_AGENT      // PHONE channel and inbound calls only
  RINGING_CUSTOMER
  ANSWERED
  COMPLETED
  NO_ANSWER
  BUSY
  FAILED
  CANCELLED
}

enum TelephonyRecordingStatus {
  PENDING        // provider has not reported a recording yet
  DOWNLOADING    // the background job is fetching and compressing it
  STORED         // saved in FileStorage
  FAILED         // could not be fetched (for example the provider link expired)
  DELETED        // removed by the retention job
}

// Non-secret provider settings. Secrets (API keys, tokens) come from env / the secret store, never from this table.
model TelephonyProviderAccount {
  id          String   @id @default(uuid(7)) @db.Uuid
  providerKey String   @unique                                     // adapter key, e.g. "fake", "exotel"
  displayName String
  config      Json     @default("{}")                              // caller ID number, region, etc. (no secrets)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@map("telephony_provider_accounts")
}

// Per-agent login for providers that use fixed SIP logins. Token-based providers leave the secret empty.
model TelephonyAgentEndpoint {
  id              String       @id @default(uuid(7)) @db.Uuid
  providerKey     String
  userId          String       @db.Uuid                            // → identity.identity_users
  user            IdentityUser @relation(fields: [userId], references: [id], onDelete: Restrict)
  loginEncrypted  String?                                          // SIP username or provider agent ID (encrypted)
  secretEncrypted String?                                          // SIP password, if the provider needs one (encrypted)
  isActive        Boolean      @default(true)
  createdAt       DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime     @updatedAt @db.Timestamptz(3)

  @@unique([providerKey, userId])
  @@map("telephony_agent_endpoints")
}

// PII (phone number)
model TelephonyCall {
  id                String              @id @default(uuid(7)) @db.Uuid
  providerKey       String
  providerCallId    String?                                         // set once the provider reports it
  callRef           String              @unique                    // our reference, created when the call starts
  direction         TelephonyDirection  @default(OUTBOUND)
  channel           TelephonyChannel    @default(BROWSER)
  status            TelephonyCallStatus @default(INITIATED)
  leadId            String?             @db.Uuid                   // → leads.leads_leads
  lead              LeadsLead?          @relation(fields: [leadId], references: [id], onDelete: Restrict)
  agentUserId       String?             @db.Uuid                   // → identity.identity_users (null = inbound call nobody answered)
  agent             IdentityUser?       @relation(fields: [agentUserId], references: [id], onDelete: Restrict)
  customerPhoneE164 String
  routingNote       String?                                         // inbound: which rule chose the agent (internal)
  startedAt         DateTime            @db.Timestamptz(3)
  answeredAt        DateTime?           @db.Timestamptz(3)
  endedAt           DateTime?           @db.Timestamptz(3)
  durationSeconds   Int?
  billableSeconds   Int?
  outcomeCode       String?                                         // from the call outcome form
  outcomeNotes      String?
  createdAt         DateTime            @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime            @updatedAt @db.Timestamptz(3)
  recording         TelephonyRecording?

  @@unique([providerKey, providerCallId])
  @@index([leadId, startedAt])
  @@index([agentUserId, startedAt])
  @@index([customerPhoneE164])
  @@index([status])
  @@map("telephony_calls")
}

// Recording metadata only. The audio file lives in FileStorage under storageKey.
model TelephonyRecording {
  id                   String                   @id @default(uuid(7)) @db.Uuid
  callId               String                   @unique @db.Uuid
  call                 TelephonyCall            @relation(fields: [callId], references: [id], onDelete: Cascade)
  status               TelephonyRecordingStatus @default(PENDING)
  providerRecordingRef String?                                      // provider's recording URL or ID; internal, never sent to the browser
  storageKey           String?                  @unique             // e.g. "recordings/2026/12/<callId>.mp3"; same key on every storage driver
  contentType          String?                                      // e.g. "audio/mpeg"
  sizeBytes            Int?
  durationSeconds      Int?
  checksumSha256       String?
  attempts             Int                      @default(0)
  lastError            String?                                      // internal; never shown to users
  readyAt              DateTime?                @db.Timestamptz(3)  // provider reported the recording
  storedAt             DateTime?                @db.Timestamptz(3)
  expiresAt            DateTime?                @db.Timestamptz(3)  // retention deadline (retention.recordingDays)
  deletedAt            DateTime?                @db.Timestamptz(3)
  createdAt            DateTime                 @default(now()) @db.Timestamptz(3)
  updatedAt            DateTime                 @updatedAt @db.Timestamptz(3)

  @@index([status])
  @@index([expiresAt])
  @@map("telephony_recordings")
}

// Append-only raw webhook log; processing runs as a background job (Decision 27)
model TelephonyWebhookEvent {
  id          String    @id @default(uuid(7)) @db.Uuid
  providerKey String
  eventKey    String                                               // provider call ID + event type
  payload     Json
  receivedAt  DateTime  @default(now()) @db.Timestamptz(3)
  processedAt DateTime? @db.Timestamptz(3)
  error       String?

  @@unique([providerKey, eventKey])
  @@index([receivedAt])
  @@map("telephony_webhook_events")
}
```

### 3.6 `system`, `notifications`, `reporting`, `audit`

```prisma
// system — PHASE 0 (written by the worker every few seconds; read by the diagnostics page)
model SystemWorkerHeartbeat {
  workerId   String   @id                                           // hostname + process id
  version    String                                                 // app version / git SHA
  startedAt  DateTime @db.Timestamptz(3)
  lastBeatAt DateTime @db.Timestamptz(3)

  @@map("system_worker_heartbeats")
}

// system — PHASE 3 onward (first used by assignment timeouts, SLA and retention)
model SystemSetting {
  key             String        @id                                 // e.g. "assignment.timeoutMinutes"
  value           Json
  updatedByUserId String?       @db.Uuid                            // → identity.identity_users
  updatedBy       IdentityUser? @relation(fields: [updatedByUserId], references: [id], onDelete: Restrict)
  updatedAt       DateTime      @updatedAt @db.Timestamptz(3)

  @@map("system_settings")
}

// notifications — PHASE 8
model NotificationsNotification {
  id        String       @id @default(uuid(7)) @db.Uuid
  userId    String       @db.Uuid                                   // → identity.identity_users
  user      IdentityUser @relation(fields: [userId], references: [id], onDelete: Restrict)
  kind      String
  title     String
  body      String?
  link      String?
  readAt    DateTime?    @db.Timestamptz(3)
  createdAt DateTime     @default(now()) @db.Timestamptz(3)

  @@index([userId, readAt, createdAt])
  @@map("notifications_notifications")
}

// reporting — PHASE 9 (only if live queries become too slow)
model ReportingDailySnapshot {
  id           String   @id @default(uuid(7)) @db.Uuid
  businessDate DateTime @db.Date                                    // the business-timezone day this row summarises
  scopeKey     String                                               // "all", "team:<id>", "user:<id>" (not a foreign key)
  metrics      Json
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  @@unique([businessDate, scopeKey])
  @@map("reporting_daily_snapshots")
}

// audit — PHASE 1 (table and writer, so user and role changes are audited from the start); the audit views arrive in Phase 10. Append-only.
model AuditEvent {
  id            String        @id @default(uuid(7)) @db.Uuid
  occurredAt    DateTime      @db.Timestamptz(3)
  actorUserId   String?       @db.Uuid                              // → identity.identity_users (null = system: job or webhook)
  actor         IdentityUser? @relation(fields: [actorUserId], references: [id], onDelete: Restrict)
  actorRoleCode String?                                             // role at the time, e.g. SUPER_ADMIN
  action        String                                              // e.g. "lead.assigned", "role.permissions_changed", "recording.played"
  entityType    String                                              // polymorphic: no FK
  entityId      String                                              // polymorphic: no FK
  summary       String
  metadata      Json          @default("{}")
  requestId     String?
  createdAt     DateTime      @default(now()) @db.Timestamptz(3)

  @@index([entityType, entityId, occurredAt])
  @@index([actorUserId, occurredAt])
  @@index([action, occurredAt])
  @@map("audit_events")
}
```

---

## 4. Entity Relationship Overview

Solid lines are relations inside a module. Dotted lines are **cross-module foreign keys** (Decision 22).

```
identity                                  leads
────────                                  ─────
IdentityRole ──< IdentityRolePermission    LeadsPipelineStage ──< LeadsLead >── LeadsContact
     │                  │                                          │
     └──< IdentityUser >┘ IdentityPermission                       ├──< LeadsNote
          │   │   └── self (manager)                               ├──< LeadsTask
          │   └──< IdentitySession                                 └──< LeadsTimelineEntry
          └── IdentityTeam

messaging                                 assignment
─────────                                 ──────────
MessagingConversation ──< MessagingMessage   AssignmentBatch ──< AssignmentRecord
MessagingTemplate                            AssignmentAgentSetting ──< AssignmentShift
MessagingWebhookEvent                        AssignmentPoolEntry ──< AssignmentPoolEligibility
                                             AssignmentRule

telephony                                 system / notifications / reporting / audit
─────────                                 ──────────────────────────────────────────
TelephonyCall ──1:1── TelephonyRecording     SystemSetting · SystemWorkerHeartbeat
TelephonyAgentEndpoint                       NotificationsNotification
TelephonyProviderAccount                     ReportingDailySnapshot · AuditEvent
TelephonyWebhookEvent

Cross-module foreign keys (dotted)
  LeadsLead.ownerUserId, LeadsNote/Task/TimelineEntry users ··> IdentityUser
  MessagingConversation.contactId / leadId / ownerUserId ·····> LeadsContact / LeadsLead / IdentityUser
  MessagingMessage.sentByUserId ······························> IdentityUser
  Assignment* leadId / user IDs ······························> LeadsLead / IdentityUser
  TelephonyCall.leadId / agentUserId ·························> LeadsLead / IdentityUser
  TelephonyAgentEndpoint.userId ······························> IdentityUser
  SystemSetting / Notifications / AuditEvent user IDs ········> IdentityUser
```

---

## 5. Enum Reference

| Enum | Values | Owner |
|:---|:---|:---|
| `IdentityUserStatus` | `INVITED`, `ACTIVE`, `DEACTIVATED` | identity |
| `LeadsSource` | `WHATSAPP`, `PHONE`, `MANUAL`, `WEBSITE`, `AD`, `IMPORT` | leads |
| `LeadsStageKind` | `OPEN`, `WON`, `LOST` | leads |
| `LeadsOptInStatus` | `UNKNOWN`, `OPTED_IN`, `OPTED_OUT` | leads |
| `LeadsTimelineKind` | `LEAD_CREATED`, `STAGE_CHANGED`, `ASSIGNED`, `NOTE`, `MESSAGE`, `CALL`, `TASK` | leads |
| `MessagingDirection` | `INBOUND`, `OUTBOUND` | messaging |
| `MessagingMessageType` | `TEXT`, `IMAGE`, `DOCUMENT`, `AUDIO`, `VIDEO`, `TEMPLATE`, `INTERACTIVE`, `UNSUPPORTED` | messaging |
| `MessagingMessageStatus` | `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `RECEIVED` | messaging |
| `MessagingTemplateCategory` | `UTILITY`, `MARKETING`, `AUTHENTICATION` | messaging |
| `AssignmentMode` | `MANUAL`, `ROUND_ROBIN`, `LEAST_LOADED`, `PRIORITY`, `RANDOM`, `BLAST` | assignment |
| `AssignmentBatchStatus` | `COMMITTED`, `FAILED` | assignment |
| `AssignmentPoolStatus` | `OPEN`, `CLAIMED`, `EXPIRED`, `CANCELLED` | assignment |
| `TelephonyDirection` | `OUTBOUND`, `INBOUND` | telephony |
| `TelephonyChannel` | `BROWSER`, `PHONE` | telephony |
| `TelephonyCallStatus` | `INITIATED`, `RINGING_AGENT`, `RINGING_CUSTOMER`, `ANSWERED`, `COMPLETED`, `NO_ANSWER`, `BUSY`, `FAILED`, `CANCELLED` | telephony |
| `TelephonyRecordingStatus` | `PENDING`, `DOWNLOADING`, `STORED`, `FAILED`, `DELETED` | telephony |

---

## 6. Constraints and Indexes Prisma Cannot Express (raw SQL in migrations)

> **Column names in raw SQL.** Models use no field-level `@map`, so each column is named exactly like its Prisma field (camelCase) and must be **double-quoted** in SQL, for example `"phoneE164"`. Table names are the `@@map` names (snake_case, no quotes needed).

| Table | Constraint | Purpose |
|:---|:---|:---|
| `leads_contacts` | `CHECK ("phoneE164" ~ '^\+[1-9][0-9]{6,14}$')` | E.164 only |
| `identity_users` | `CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{6,14}$')` | E.164 only |
| `telephony_calls` | `CHECK ("customerPhoneE164" ~ '^\+[1-9][0-9]{6,14}$')` | E.164 only |
| `identity_users` | `CREATE UNIQUE INDEX ... ON identity_users (lower("email"))` | Case-insensitive uniqueness |
| `identity_roles` | `CREATE UNIQUE INDEX ... ON identity_roles ("bypassesAccess") WHERE "bypassesAccess"` | At most one bypass role (`SUPER_ADMIN`) |
| `identity_roles` | Trigger: a row with `"isSystem"` cannot be deleted; for the `"bypassesAccess"` row, `DELETE` and any change to `"code"` or `"bypassesAccess"` raise (other columns such as `"updatedAt"` may change, so `db:sync-rbac` upserts still work) | Protect system roles and `SUPER_ADMIN` (the service also checks) |
| `identity_role_permissions` | Trigger on insert: raise if the permission has `"isReserved" = true`, or if the role has `"bypassesAccess" = true` | Reserved permissions can never be granted; `SUPER_ADMIN` holds no grants (Decision 23) |
| `assignment_pool_entries` | `CREATE UNIQUE INDEX ... ON assignment_pool_entries ("leadId") WHERE "status" = 'OPEN'` | A lead can have only one open pool entry |
| `assignment_pool_entries` | Claim via `UPDATE assignment_pool_entries SET "status" = 'CLAIMED', ... WHERE "id" = $1 AND "status" = 'OPEN'` and check the affected-row count | Atomic claim: exactly one agent wins (Rule 8) |
| `assignment_rules` | `CREATE UNIQUE INDEX ... ON assignment_rules ("isAutoAssign") WHERE "isAutoAssign" AND "isActive"` | At most one active auto-assign rule |
| `assignment_shifts` | `CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")` | Valid shift |
| `telephony_recordings` | `CHECK ("status" <> 'STORED' OR "storageKey" IS NOT NULL)` | A stored recording always has a storage key |
| `audit_events`, `messaging_webhook_events`, `telephony_webhook_events` | Revoke `UPDATE` and `DELETE` for the application role, or add a trigger that raises | Append-only (the retention job for webhook logs runs as a separate maintenance role) |

**Rules enforced in the service, not the database:** at least one **active** Super Admin must always exist (deactivating, demoting or deleting the last one fails with `CONFLICT`); an Admin cannot create, edit or deactivate a Super Admin (Decision 23).

**Drift check (confirmed in W-007, Prisma 7.10.1):** `db:migrate:check` applies the migrations to the test database and diffs it against `schema.prisma` (`migrate diff --from-config-datasource --to-schema --exit-code`). The raw-SQL partial index and triggers are not reported as drift, a `pgboss` schema is ignored, and the next `migrate dev` generates no `DROP` for them. No shadow database is needed. UUID v7 (`uuid(7)`) is accepted; Prisma Client generates the value, so the columns have no database default.

---

## 7. Personal Data Map (DPDP readiness)

| Table.column | Data | Handling |
|:---|:---|:---|
| `leads_contacts.phoneE164`, `.name`, `.email` | Customer identity | Anonymise on erasure request: replace with a non-reversible placeholder and set `anonymisedAt`. The row stays so history remains consistent. |
| `leads_leads.customFields`, `.destination`, `.travel*` | Trip details | Retention policy in `system_settings`; anonymise with the contact. |
| `messaging_messages.body`, `.mediaRef` | Message content | Retention policy; deleted or redacted on erasure. Media files are deleted from `FileStorage`. |
| `telephony_calls.customerPhoneE164` | Phone number | Anonymised with the contact. |
| `telephony_recordings.storageKey` (the audio file in `FileStorage`), `.providerRecordingRef` | Voice recording | `expiresAt` drives automatic deletion by the retention job (file deleted, status `DELETED`). Deleted on erasure. Playback is permission-checked and audited. Keys contain no personal data. |
| `telephony_agent_endpoints.loginEncrypted`, `.secretEncrypted` | Staff calling credentials | Encrypted at rest, never logged or returned by an API. |
| `identity_users.email`, `.name`, `.phoneE164`, `.passwordHash` | Staff identity | `passwordHash` is never returned by any API or written to any log. |
| `identity_sessions.ip`, `.userAgent` | Network identifiers | Purged after expiry plus a short retention window. |
| `audit_events.metadata`, `.summary` | May reference people | Store IDs, not names or phone numbers, in `metadata`. |

Logs must redact all of the above (see `project_data.md` Section 8).

---

## 8. Shared Constants and Enum Parity

Prisma enums are **not** imported by UI code (the boundary rules forbid UI importing Prisma). Each module therefore keeps its own `as const` constants, for example in `src/modules/assignment/assignment.types.ts`:

```ts
export const ASSIGNMENT_MODES = [
  'MANUAL',
  'ROUND_ROBIN',
  'LEAST_LOADED',
  'PRIORITY',
  'RANDOM',
  'BLAST',
] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];
```

**Parity test (unit):** for every Prisma enum, assert that the module's constant array equals the enum's values. The test fails if someone adds a value in one place only. Test files are exempt from the "Prisma only in repositories" import rule so this test can import the generated enums.

**Single sources of truth** (from `project_data.md` Section 7) that the schema relies on:
- Permission codes → `permissionRegistry.ts`; role bundles → `defaultRoles.ts`.
- Default pipeline stages and default settings → the constants in the seed plan below, read by both the real and test seeds.

---

## 9. Tenancy (Resolved: Single Company)

Decision 21 (resolved 2026-10-29): the platform serves **one company, Explore Hills**. There is no `tenant` table and no `tenantId` column; the business timezone and company details stay in `APP_CONFIG`. If the product is ever offered to other companies, multi-tenancy would be a deliberate redesign (a `tenantId` on every table, tenant-scoped unique constraints and settings), not something prepared now.

---

## 10. Seed Data Plan

| Seed | Where | Content | Committed? |
|:---|:---|:---|:---|
| **RBAC sync** (`db:sync-rbac`) | Every environment | All permissions from the registry (code, label, description, module, reserved flag); system roles `SUPER_ADMIN` (`bypassesAccess = true`, no grants), `ADMIN`, `MANAGER`, `AGENT`. Default grants are applied only when a role is created or a permission is new; grants edited on the Roles & Permissions page are never overwritten (Decision 23). | Yes (code); no secrets |
| **Reference data** | Run by both seeds through shared functions | Default pipeline stages (Phase 3); default `system_settings` values (below); a `telephony_provider_accounts` row for the active provider (Phase 7) | Yes (code); no secrets |
| **Real seed** (`db:seed`) | Dev and production only | The **first Super Admin** (from `SEED_SUPER_ADMIN_*` env values) and real team members. Phase 0 builds the file and its guards; it creates users from Phase 1, when `identity_users` exists. | **No.** `prisma/private/seed.ts`, git-ignored |
| **Test seed** (`db:seed:test`) | Test database only | Phase 0: RBAC data only. From Phase 1: fake users and the fixtures below, added phase by phase as their tables arrive. | Yes; credentials come from `.env.test` |

### Default pipeline stages (travel)

| code | name | position | kind |
|:---|:---|:---|:---|
| `NEW` | New | 10 | OPEN |
| `CONTACTED` | Contacted | 20 | OPEN |
| `QUALIFIED` | Qualified | 30 | OPEN |
| `QUOTED` | Quote sent | 40 | OPEN |
| `WON` | Booked | 90 | WON |
| `LOST` | Lost | 99 | LOST |

"Unassigned" is not a stage: it means `ownerUserId` is `null` (Section 3.2).

### Default system settings (proposed; confirm with Explore Hills)

| Key | Proposed default | Used by |
|:---|:---|:---|
| `assignment.timeoutMinutes` | `30` | Return-to-pool or escalation job (`project_data.md` 3.3) |
| `assignment.defaultOpenLeadCap` | `50` | Eligibility filter |
| `assignment.poolExpiryMinutes` | `15` | BLAST pool expiry job |
| `sla.firstResponseMinutes` | `15` | Phase 8 reminders |
| `telephony.inboundFallback` | `"available_agent"` | Inbound call when the lead owner is offline: ring any available eligible agent; if none, log a missed call and notify the manager |
| `recording.format` | `"mp3"` | Recording compression job |
| `recording.bitrateKbps` | `24` | Recording compression job (mono) |
| `retention.recordingDays` | `180` | `telephony_recordings.expiresAt` and the retention job |
| `retention.messageDays` | `730` | Message retention |
| `retention.webhookEventDays` | `30` | Webhook log clean-up job |
| `realtime.pollFallbackSeconds` | `15` | Polling interval when the live-update stream cannot connect |

### Test seed fixtures (deterministic, test database only)

- Users: one `SUPER_ADMIN`, one `ADMIN`, one `MANAGER` with a team, five `AGENT`s (the first uses `TEST_AGENT_EMAIL`; the others use numbered emails such as `agent2.test@example.com`, all with `TEST_AGENT_PASSWORD`), one deactivated agent.
- One custom role with a small permission bundle, to exercise the Roles & Permissions page.
- Pipeline stages and settings as above.
- Contacts and leads: 20 unassigned leads, plus leads in every stage owned by different agents, so scoping, sorting and filtering are testable.
- A lead created at `23:59` and another at `00:01` business time around a month boundary, to exercise midnight logic (Rule 4).
- A conversation with an inbound message 23 hours ago and another 25 hours ago, to exercise the 24-hour window.
- One open BLAST pool entry with three eligible agents.
- `fake` provider: an account row, an agent endpoint, one completed call with a `STORED` recording (a short audio file in the test storage folder) and one call with a `FAILED` recording.

Test fixtures never contain real names, phone numbers or emails (use obviously fake values on reserved example domains and fictitious numbers).

---

## 11. Phase-by-Phase Table Delivery

| Phase | Tables added | Back-relation fields added (no SQL) |
|:---|:---|:---|
| 0 | `identity_permissions`, `identity_roles`, `identity_role_permissions`, `system_worker_heartbeats` (pg-boss creates its own `pgboss` schema at worker start) | |
| 1 | `identity_users`, `identity_sessions` (shape per Decision 20), `audit_events` (table and writer) | `IdentityRole`: users; `IdentityUser`: auditEvents |
| 2 | `identity_teams`, hierarchy columns | |
| 3 | `leads_pipeline_stages`, `leads_contacts`, `leads_leads`, `leads_notes`, `leads_tasks`, `leads_timeline_entries`, `system_settings` | `IdentityUser`: ownedLeads, leadNotes, leadTasks, timelineEntries, updatedSettings |
| 4 | `messaging_conversations`, `messaging_messages`, `messaging_templates`, `messaging_webhook_events` | `IdentityUser`, `LeadsLead`, `LeadsContact`: conversations / sent messages |
| 5 | `assignment_agent_settings`, `assignment_shifts`, `assignment_rules`, `assignment_batches`, `assignment_records`, `assignment_pool_entries`, `assignment_pool_eligibility` | `IdentityUser`, `LeadsLead`: assignment relations |
| 7 | `telephony_provider_accounts`, `telephony_agent_endpoints`, `telephony_calls`, `telephony_recordings`, `telephony_webhook_events` | `IdentityUser`, `LeadsLead`: calls, endpoints |
| 8 | `notifications_notifications` | `IdentityUser`: notifications |
| 9 | `reporting_daily_snapshots` (only if needed) | |
| 10 | Audit views only (the table exists from Phase 1) | |
