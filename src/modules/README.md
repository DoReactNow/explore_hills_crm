# Modules

Each folder here is one module of the modular monolith (`CONTEXT/project_data.md` Section 4.2).
`system` is the reference implementation; copy its shape when you add or fill a module.

| Module          | Owns                                                                     | Built in                          |
| :-------------- | :----------------------------------------------------------------------- | :-------------------------------- |
| `system`        | Health check, diagnostics, worker heartbeat, system settings             | Phase 0                           |
| `identity`      | Users, teams, roles, permissions, sessions, the Roles & Permissions page | Phase 0 (RBAC tables), Phases 1–2 |
| `leads`         | Leads, contacts, pipeline stages, notes, tasks, follow-ups               | Phase 3                           |
| `messaging`     | WhatsApp inbox, conversations, templates, opt-in                         | Phase 4                           |
| `assignment`    | Routing modes, queue, claim pool, timeouts, caps                         | Phase 5                           |
| `telephony`     | Provider adapters, softphone UI, call logs, inbound routing, recordings  | Phase 7                           |
| `notifications` | In-app (later email/push) notifications, reminders                       | Phase 8                           |
| `reporting`     | Dashboards and exports                                                   | Phase 9                           |
| `audit`         | Append-only audit trail                                                  | Phase 1 (table), Phase 10 (views) |

## Module template

```
src/modules/<module>/
  <module>.controller.ts   access declaration, Zod parsing, calls the service, shapes the response
  <module>.service.ts      business rules, scope, transactions, events (no HTTP types)
  <module>.repository.ts   Prisma queries; writes only this module's tables
  <module>.schemas.ts      Zod schemas with friendly messages
  <module>.types.ts        types and `as const` arrays (mirrors of Prisma enums)
  <module>.events.ts       events and live-update event types it publishes
  <module>.jobs.ts         background jobs it defines
  ui/                      React components
  __tests__/               *.unit.test.ts(x), *.int.test.ts
  index.ts                 public API: the only file other modules may import
```

Build a feature bottom up: schema → repository → service → controller → `src/app/api/.../route.ts`
(a one-line `route({ access, handler })` adapter) → UI.

## Rules (enforced by `npm run lint:arch`)

1. Other modules import a module **only through its `index.ts`**.
2. Only `src/app/**` imports a `*.controller.ts`.
3. Only repositories (plus seeds, scripts and `src/shared/db`) import Prisma.
4. `src/shared/**` never imports `src/modules/**` or `src/worker/**`. Jobs and live-update event
   types are exported from each module's `index.ts` and assembled in `src/worker/` and `src/app/`.
5. UI code never imports repositories, services, controllers or Prisma.
6. A repository **writes** only its own module's tables; it may **read** other modules' tables
   through Prisma relations (Decision 22). Checked in review and by integration tests.
7. No circular imports.
8. Only the telephony registries import a provider folder, only `src/shared/storage/registry.ts`
   imports a storage driver, and only `src/shared/jobs/` imports pg-boss.

## Adding a module

1. Create the folder with the files it needs from the template, and an `index.ts`.
2. Add its tables to `prisma/schema.prisma` with the module prefix (`<module>_<plural_noun>`).
3. Add its permissions to `src/shared/rbac/permissionRegistry.ts` before using them.
4. Add a row to the table above.
