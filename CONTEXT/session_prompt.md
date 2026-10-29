# Session Prompt: Explore Hills CRM

Paste this at the start of every new coding session.

---

You are working on **Explore Hills CRM**, a WhatsApp lead-assignment CRM with browser calling, built for one company: Explore Hills. All planning lives in the `CONTEXT/` folder at the project root. The docs are the source of truth. Do not work from memory or assumptions.

## 1. Read before doing anything

Always read these, in this order:

1. `CONTEXT/current_state.md`: what is done, what is next, and the phase plan. Find the first phase or work item that is not done.
2. `CONTEXT/decision_log.md`: every accepted decision and every **Open** one. Follow the newest decision when an older one is marked amended or superseded.
3. `CONTEXT/TDD_INSTRUCTION_GUIDE.md`: how work items are written and executed (test first, verification chain, project rules).

Then read what the current work needs:

| If the work touches… | Read |
|:---|:---|
| Business rules, architecture, roles and permissions, jobs, live updates, adapters, environments | `CONTEXT/project_data.md` |
| Tables, columns, relations, constraints, seeds | `CONTEXT/database_schema.md` |
| Running, testing, Docker, env files, commands | `CONTEXT/local_setup.md` |
| What the product should feel like for each user | `CONTEXT/WhatsApp Lead Assignment CRM The Story and What the Platform Contains.md` |

Before planning, also read the existing code in the area you will change. Check what is actually built; don't assume it from the docs.

## 2. Ask first when something is needed from me

Before you create a plan or write code, stop and ask me (one short list of questions) if any of these is true:

- The phase needs a decision that is still **Open** in `decision_log.md` (for example authentication, the WhatsApp route, the calling provider, the storage target, or the hosting target).
- A requirement is unclear, two documents disagree, or the docs disagree with the existing code.
- The work needs something only I can provide: accounts, API keys, phone numbers, company details, business rules, or approval to spend money.
- You want to change or add an architectural decision.

When I answer, log the decision in `decision_log.md` (and update any affected document) **before** you build on it. Never guess on these points.

## 3. Follow the phase plan

- If the current phase already has detailed work items in `current_state.md`, execute them **in order**, exactly as written, following the loop in `TDD_INSTRUCTION_GUIDE.md` Part 1.3. Tick each box only after its verification chain passes.
- If the current phase has **no detailed plan yet** (only the high-level summary), then:
  1. Ask me anything from Section 2 first.
  2. Investigate the existing code.
  3. Write the work items with `TDD_INSTRUCTION_GUIDE.md` (Part 2 template, Part 3 rules) under that phase in `current_state.md`.
  4. Show me the plan and **wait for my approval**. Do not write code during planning.
- Never start a phase until every box in the previous phase is ticked.
- Work **one work item at a time**. After each one, tell me what was done and what the verification chain showed, then ask before moving on to the next item.
- Keep changes to already-completed work minimal. If you must change something that is already done, say so and explain why first.

## 4. Non-negotiable rules (details in the docs)

- Test first for the risky core: assignment, blast claims, timeouts and jobs, webhooks, the RBAC guard / Super Admin bypass / scope, time handling, and adapter contracts.
- Never call a real calling provider, WhatsApp API or cloud storage in tests. Use the `fake` / `local` implementations.
- Never store audio or file bytes in the database.
- Only `SUPER_ADMIN` bypasses access checks, and only through the guard. Never check role names in feature code.
- Users only ever see friendly messages from the error catalog, never permission codes, stack traces or SQL.
- All dates go through `src/shared/time/`; no `new Date()` elsewhere.
- No secrets, real credentials or real customer data in git.

## 5. Keep the docs true

- Update `current_state.md` as items are completed.
- If you make or change a design choice, log it in `decision_log.md` first.
- If what you built differs from `project_data.md`, `database_schema.md` or `local_setup.md`, update that file in the same change.

## 6. At the end of the session

Tell me in plain language:
- what was completed,
- what is in progress,
- what is next,
- any question or decision you need from me.
