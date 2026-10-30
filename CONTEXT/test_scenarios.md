# Test Scenarios: Explore Hills CRM

The catalogue of normal, failure, race, permission, time and cross-module cases, in plain language, for every phase. **It lists what must be true, not test code.** Real tests are written during each work item, before the code they test (`TDD_INSTRUCTION_GUIDE.md`).

## How this file is used (Decision 47)

1. **Before a phase is planned**, read its section here and the section "Rules for every feature".
2. **Every scenario of that phase must map to a real test in the phase plan**, named by its ID (for example `P1-LOCK-05`), or be moved to a named later phase with the reason. Nothing is dropped silently.
3. **Answer the phase's questions first.** Where a scenario says "a stated rule", the plan must state it (and ask the owner if it is a business rule).
4. **Keep it alive.** A new edge case found while building or testing, or a production bug, is added here in the same pull request. Scenarios are never renumbered; a retired one is marked, not deleted.

**This list is as complete as we can make it today, but no list can promise every case.** That is why rule 4 exists.

**Contents:** 503 scenarios and 18 open questions, as of 2026-10-30.

| Section | Scenarios |
|:---|:---|
| Rules for every feature | 61 |
| Phase 0 | 18 |
| Phase 1 | 91 |
| Phase 2 | 30 |
| Phase 3 | 44 |
| Phase 4 | 51 |
| Phase 5 | 57 |
| Phase 6 | 10 |
| Phase 7 | 56 |
| Phase 8 | 16 |
| Phase 9 | 22 |
| Phase 10 | 17 |
| Phase 11 | 14 |
| Phase 12 | 12 |
| Phase 13 | 4 |

---

## Rules for every feature

These apply to every new endpoint, screen, job and table. A phase plan does not need to repeat them one by one, but every work item must show how it meets them.

### Access and data scope

- **X-ACCESS-01** A signed-out person gets a sign-in response, never data.
- **X-ACCESS-02** A person without the permission is refused with the friendly message, and the response contains no permission code.
- **X-ACCESS-03** A person with the permission can do the action.
- **X-ACCESS-04** The Super Admin passes the access check, but business rules still apply to them.
- **X-ACCESS-05** A person asking for a record outside their scope is told "not found", so they cannot learn it exists.
- **X-ACCESS-06** A manager sees their own team's records and not another team's.
- **X-ACCESS-07** A permission removed from a role stops working on that user's very next request.
- **X-ACCESS-08** A list never includes records outside the person's scope, even in totals, counts, exports or search results.
- **X-ACCESS-09** Changing an ID in a URL or request body cannot reach another person's record.
- **X-ACCESS-10** A hidden button is never the only protection: calling the API directly is refused too.

### Input and validation

- **X-INPUT-01** Missing, empty, wrong-type, too-long and malformed values each give a friendly message on the right field.
- **X-INPUT-02** Extra unknown fields in a request are ignored and never written to the database.
- **X-INPUT-03** Leading and trailing spaces are trimmed where it matters, and a value of only spaces counts as empty.
- **X-INPUT-04** Emoji, non-English scripts such as Hindi, apostrophes and very long names are stored and shown correctly.
- **X-INPUT-05** Text that looks like HTML or a script is shown as plain text and never runs.
- **X-INPUT-06** Text that looks like SQL is stored as plain text and does no harm.
- **X-INPUT-07** A malformed ID in a URL gives "not found", not a server error.
- **X-INPUT-08** Malformed JSON gives a friendly validation message.
- **X-INPUT-09** A very large request body is refused without harming the server.

### Errors and failures

- **X-ERROR-01** Users only ever see friendly messages: no stack trace, SQL, table name, library name, permission code or internal ID.
- **X-ERROR-02** An unexpected failure shows a friendly message with a reference, and the same reference is in the server log.
- **X-ERROR-03** If the database is down, the user gets a friendly message and health reports it; the app recovers by itself when the database returns.
- **X-ERROR-04** Secrets and personal data never appear in logs.
- **X-ERROR-05** A failed multi-step change leaves nothing half done: all of it is saved or none of it.

### Repeated and simultaneous actions

- **X-RACE-01** Double-clicking a button or re-sending the same request does not do the work twice.
- **X-RACE-02** Two people editing the same record do not silently overwrite each other: the second is told it changed, or the rule for that record is stated in its plan.
- **X-RACE-03** A browser Back or refresh after submitting a form does not submit it again.
- **X-RACE-04** A slow request that returns after the user has moved on does not overwrite the newer screen.

### Dates and time

- **X-TIME-01** "Today", "overdue" and daily totals use the business day in Asia/Kolkata: an event at 23:59 and one at 00:01 fall on different days, including across a month and year end.
- **X-TIME-02** A date with no time, such as a follow-up date or travel date, never shifts by a day, whatever the browser's or server's timezone.
- **X-TIME-03** Results are the same with the machine's timezone set to UTC, Asia/Kolkata, America/Los_Angeles or Pacific/Kiritimati.
- **X-TIME-04** A person viewing from another timezone still sees business-timezone dates.
- **X-TIME-05** Leap day (29 February) and a day at the end of a month work correctly.

### Lists and tables

- **X-LIST-01** Every sortable column sorts correctly both ways, including empty values, with a stable order when values tie.
- **X-LIST-02** Every filter narrows correctly alone and combined with the others.
- **X-LIST-03** Paging shows no duplicates or gaps when records are added during browsing.
- **X-LIST-04** Filters, sort and page survive going to a record and pressing Back.
- **X-LIST-05** An empty list, an empty search result and a failed load each show friendly text.
- **X-LIST-06** A large list stays smooth and fast with realistic data volumes.

### Background jobs

- **X-JOB-01** Running a job twice with the same input has the effect of running it once.
- **X-JOB-02** A job that fails is retried with backoff; after the last failure an alert is logged with the job ID.
- **X-JOB-03** A job whose work is no longer needed (the record changed or was closed) does nothing and finishes cleanly.
- **X-JOB-04** A job scheduled while the worker is down runs when it returns, and is not lost.
- **X-JOB-05** Stopping the worker in the middle of a job does not lose it or corrupt data.
- **X-JOB-06** Two workers running at once do not process the same job twice.
- **X-JOB-07** A job payload that fails validation is refused before it is queued.

### Live updates

- **X-LIVE-01** Each event carries IDs only and reaches only people allowed to see the record it points to.
- **X-LIVE-02** After a reconnect the screen fetches its current state and shows nothing stale.
- **X-LIVE-03** If the live connection cannot start, the screen still works by polling.
- **X-LIVE-04** A person whose access was removed stops receiving that event type.
- **X-LIVE-05** A notice for a record that has since disappeared does not break the screen.
- **X-LIVE-06** Opening the app in several tabs works in all of them.

### Screens

- **X-UI-01** Every action shows a clear busy state, success or failure.
- **X-UI-02** Every screen works by keyboard, has labels for screen readers, and stays usable on a narrow screen.
- **X-UI-03** A session that ends while a screen is open leads to sign-in, then back to the same screen, without losing typed text where practical.
- **X-UI-04** Losing the network while using a screen shows a friendly message, and the screen recovers when it returns.

### Data and audit

- **X-DATA-01** Every important change writes an audit event with who, what and when, in the same transaction as the change.
- **X-DATA-02** Audit events hold IDs, not names, emails or phone numbers.
- **X-DATA-03** Files are never stored in the database, and file keys never contain personal data.
- **X-DATA-04** No test uses real names, phone numbers, emails, real providers or the development database.
- **X-DATA-05** Deleting is never the default: records that others point to are deactivated, soft-deleted or anonymised.

---

## Phase 0: Foundation (built; these must stay green)

### Environment

- **P0-ENV-01** A missing or invalid setting stops the app with a clear message that names the setting and never shows its value.
- **P0-ENV-02** Test settings refuse any database not ending in _test; production settings refuse one that does.
- **P0-ENV-03** Production refuses fake providers and placeholder secrets.
- **P0-ENV-04** The build needs no database and no secrets.

### Architecture

- **P0-ARCH-01** Each boundary rule fails on a bad import: module internals, controllers outside the app, Prisma outside repositories, shared importing modules, UI importing server code, circular imports, provider, storage driver and pg-boss imports.
- **P0-ARCH-02** A route without route(), or a public route not on the allow-list, fails the test suite.
- **P0-ARCH-03** A new email or phone literal or company name outside APP_CONFIG fails the test suite.

### Tooling, seeds and deployment

- **P0-OPS-01** Every npm script in package.json works. Known gap: db:reset:dev and db:reset:test point to scripts/reset-db.ts, which does not exist yet.
- **P0-OPS-02** db:reset refuses to reset a database that does not match its environment file, and refuses production.
- **P0-OPS-03** A fresh clone following the setup guide works from start to finish.
- **P0-OPS-04** Tests leave the development database untouched and git clean.
- **P0-OPS-05** A real env file or anything in prisma/private cannot be committed without the guard failing.
- **P0-OPS-06** A failing migration stops the app and worker from starting.
- **P0-OPS-07** Production containers run as non-root on a read-only filesystem.

### Jobs, live updates and files

- **P0-FOUND-01** A job, live event and file each behave as in the rules above, proven by the Phase 0 tests.
- **P0-FOUND-02** A write that dies midway leaves no partial file, and an existing file survives a failed overwrite.
- **P0-FOUND-03** A storage key with "..", a leading slash, a backslash or personal data is refused.
- **P0-FOUND-04** A live-update relay that loses its database connection closes its streams so browsers reconnect.

---

## Phase 1: Identity

### Signing in

- **P1-SIGNIN-01** Correct email and password signs in, sets a secure cookie and records the time.
- **P1-SIGNIN-02** Email is matched regardless of case, and spaces around it are ignored.
- **P1-SIGNIN-03** A password is matched exactly: case and spaces matter.
- **P1-SIGNIN-04** A wrong password, an unknown email, an invited user and a deactivated user all get the same message and take about the same time, so nobody can discover which accounts exist.
- **P1-SIGNIN-05** A missing email or password gives a field message.
- **P1-SIGNIN-06** An extremely long password is refused quickly and cannot be used to slow the server.
- **P1-SIGNIN-07** A password with emoji or non-English characters works.
- **P1-SIGNIN-08** Signing in while already signed in gives one valid session and does not break the old state.
- **P1-SIGNIN-09** Signing in from two devices works, and each has its own session.
- **P1-SIGNIN-10** The session token never appears in a response body, URL or log.
- **P1-SIGNIN-11** After sign-in the user returns to the page they wanted; a return address pointing to another website is ignored.

### Lockout and throttling

- **P1-LOCK-01** Four wrong passwords then a right one signs in and resets the count.
- **P1-LOCK-02** The fifth wrong password locks the account for exactly 15 minutes.
- **P1-LOCK-03** The right password during a lock is still refused with the "too many attempts" message.
- **P1-LOCK-04** At 15 minutes the account works again and the count starts fresh.
- **P1-LOCK-05** Five wrong passwords sent at the same moment are all counted: the lock cannot be avoided by sending them in parallel.
- **P1-LOCK-06** Wrong attempts during a lock do not extend it indefinitely, unless the plan states otherwise.
- **P1-LOCK-07** An attacker cannot lock a real user out forever by constantly guessing: the rule and its limit are stated and tested.
- **P1-LOCK-08** An unknown email follows the same visible behaviour, so lockout cannot reveal which accounts exist.
- **P1-LOCK-09** The 21st attempt from one IP within 15 minutes is refused, and it works after the window passes.
- **P1-LOCK-10** Attempts from different IPs are counted separately, and a faked proxy header cannot dodge the limit or frame another address.
- **P1-LOCK-11** When the IP cannot be read, attempts still have a safe limit.
- **P1-LOCK-12** Two simultaneous attempts cannot both slip past the last allowed count.
- **P1-LOCK-13** Throttle rows hold a hash of the IP, never the IP.

### Sessions

- **P1-SESSION-01** A session unused for 11 hours 59 minutes still works, and that use extends it.
- **P1-SESSION-02** A session unused for 12 hours has expired.
- **P1-SESSION-03** A constantly active session still expires 7 days after sign-in.
- **P1-SESSION-04** Activity writes to the database at most once every 5 minutes.
- **P1-SESSION-05** Many requests arriving together with the same cookie all work, and do not cause errors or extra writes.
- **P1-SESSION-06** A changed, invented or malformed cookie is simply signed out, never an error.
- **P1-SESSION-07** A request exactly at the expiry moment is treated as expired.
- **P1-SESSION-08** The database holds only a hash of the token: a leaked database row cannot be used to sign in.
- **P1-SESSION-09** Sign-out ends only this session; other devices stay signed in unless a "sign out everywhere" action exists.
- **P1-SESSION-10** Sign-out twice, or with an expired session, succeeds quietly.
- **P1-SESSION-11** After sign-out, Back in the browser does not show protected data.
- **P1-SESSION-12** Deactivating a user ends all of their sessions at once, including a request in progress on its next check.
- **P1-SESSION-13** A role change applies on the next request without signing in again.
- **P1-SESSION-14** Deleting expired sessions does not touch active ones.

### Requests from other websites

- **P1-CSRF-01** A write request with a session cookie from another website is refused.
- **P1-CSRF-02** A write from the app's own address works, including behind the production proxy address.
- **P1-CSRF-03** A write with no Origin header follows the stated rule and is tested.
- **P1-CSRF-04** A safe read never changes data.
- **P1-CSRF-05** The cookie is sent over HTTPS only in production, and is not readable by page scripts.

### Passwords

- **P1-PASS-01** Passwords are stored only as argon2id hashes, and two users with the same password have different hashes.
- **P1-PASS-02** A weak, short, common or placeholder password is refused with a friendly message that never repeats it.
- **P1-PASS-03** A password equal to or containing the user's email or name is refused.
- **P1-PASS-04** A malformed stored hash gives a failed sign-in, not a server error.
- **P1-PASS-05** Password hashes never appear in any response, log, audit event or export.
- **P1-PASS-06** Hashing many passwords at once cannot starve the server.
- **P1-PASS-07** An Admin sets a default password when creating a user; it follows the strength rule and is never shown again, logged or audited.
- **P1-PASS-08** Only an Admin (with the permission) can change a user's password; a user cannot change their own, and no "forgot password" route exists.
- **P1-PASS-09** Changing a password signs that user out of all running sessions at once, including a request made at the same moment; the old password stops working and the new one works.
- **P1-PASS-10** Changing a password clears that user's failed-attempt count and lock.
- **P1-PASS-11** An Admin cannot change a Super Admin's password, by any route; a Super Admin can.
- **P1-PASS-12** Each password change is audited with who and whose, never the password.
- **Q-01 (answered, Decision 48):** An Admin gives the default password and only an Admin changes it later.
- **Q-02 (answered, Decision 48):** Yes, changing a password signs the user out of all running sessions.
- **P1-PASS-13** A private operator command, run on the server, sets a new password for a Super Admin, signs them out everywhere and is audited; no web route can do this.
- **P1-PASS-14** The operator command refuses a weak password, an unknown or non-Super-Admin account, and a test or mismatched database, and never prints the password.
- **Q-21 (answered, Decision 49):** An operator resets it with a private command on the server.

### Managing users

- **P1-USER-01** Creating a user stores the email in lowercase and writes an audit event.
- **P1-USER-02** Creating a user with an email already used, in any case, is refused, even when two requests arrive together.
- **P1-USER-03** An email of a deactivated user stays taken unless the plan states otherwise.
- **P1-USER-04** Editing a user cannot change their password hash, lock fields or status through the ordinary edit route.
- **P1-USER-05** A user cannot be given a role that does not exist.
- **P1-USER-06** A manager with only view rights can view users but not change them.
- **P1-USER-07** An agent cannot view the user list.
- **P1-USER-08** Nobody can hard-delete a user, through any route.
- **P1-USER-09** Reactivating a user restores sign-in but not old sessions.
- **P1-USER-10** A user editing their own account follows a stated rule: they cannot raise their own role or deactivate themselves into a locked-out company.
- **P1-USER-11** Responses never include the hash, failed count or lock time.

### Super Admin protections

- **P1-SUPER-01** An Admin cannot create, edit, deactivate, reactivate or re-role a Super Admin, or give anyone the Super Admin role.
- **P1-SUPER-02** An Admin cannot reach those actions by any other route, or by a bulk request.
- **P1-SUPER-03** A Super Admin can do all of those.
- **P1-SUPER-04** Deactivating or demoting the last active Super Admin is refused.
- **P1-SUPER-05** Two Super Admins deactivating each other at the same moment cannot leave zero active: one is refused.
- **P1-SUPER-06** An invited or deactivated Super Admin does not count as active.
- **P1-SUPER-07** Super Admin actions are audited like anyone else's.
- **P1-SUPER-08** Reserved permissions cannot be granted, by the service or directly in the database.
- **P1-SUPER-09** The Super Admin bypass cannot be switched on for another role.

### Audit trail

- **P1-AUDIT-01** Sign-in, sign-out, failed sign-in, lockout and every user change each write an audit event.
- **P1-AUDIT-02** A change that rolls back leaves no audit event.
- **P1-AUDIT-03** A failed audit write fails the change, so nothing goes unrecorded.
- **P1-AUDIT-04** Audit rows cannot be edited or deleted through the app or directly in the database.
- **P1-AUDIT-05** A failed sign-in for an unknown email records no fake user link and no password.
- **P1-AUDIT-06** System actions are recorded with no user.
- **P1-AUDIT-07** Audit metadata that looks like an email or phone number is refused.

### Seeds

- **P1-SEED-01** The test seed run twice gives identical users, and each can sign in.
- **P1-SEED-02** The real seed creates one Super Admin, and does nothing when an active one exists.
- **P1-SEED-03** The real seed refuses a test database and a weak password.
- **P1-SEED-04** The real seed with a deactivated Super Admin only follows a stated rule.
- **P1-SEED-05** RBAC sync run on every deploy never removes a user's role, and never overwrites edited grants.

### End to end

- **P1-E2E-01** Each role signs in through the real form and sees only what it may use.
- **P1-E2E-02** Every guarded route is tested against every role, and a new guarded route not in the test fails the suite.

---

## Phase 2: Teams, hierarchy and the Roles & Permissions page

### Hierarchy and teams

- **P2-HIER-01** A user cannot be their own manager, and a manager loop (A reports to B, B to A, or longer) is refused, even when two changes arrive together.
- **P2-HIER-02** A manager sees direct reports, and the plan states whether reports-of-reports count.
- **P2-HIER-03** Moving an agent to a new manager changes what both managers see on the next request, including their open leads.
- **P2-HIER-04** A deactivated manager's agents still have a defined owner of supervision, and no records become invisible to everyone.
- **P2-HIER-05** A deactivated agent stays visible in history under their name.
- **P2-HIER-06** Deleting a team with members, or a team's manager leaving, follows a stated rule.
- **P2-HIER-07** Two teams cannot share a name, in any case.
- **P2-HIER-08** An agent with no team or manager still sees their own records.
- **P2-HIER-09** A manager with no agents sees only their own.
- **Q-03 (answered, Decision 55):** Team visibility covers the whole chain below a person.
- **Q-04 (answered, Decision 55):** A person can belong to several teams.

### Roles & Permissions page

- **P2-ROLES-01** Only the Super Admin can open the page or call its API; an Admin is refused.
- **P2-ROLES-02** Creating a role with a duplicate name or code, in any case, is refused.
- **P2-ROLES-03** A custom role can be renamed but its code stays stable, and an edit to a system role follows the Decision 23 rules.
- **P2-ROLES-04** Deleting a role still held by a user is refused with a friendly message, even if someone is assigned at the same moment.
- **P2-ROLES-05** System roles cannot be deleted, and Super Admin cannot be edited at all.
- **P2-ROLES-06** Reserved permissions are not offered, and a request that sends one anyway is refused.
- **P2-ROLES-07** Granting a permission unknown to the registry is refused.
- **P2-ROLES-08** Two Super Admins editing one role at once do not silently lose a change.
- **P2-ROLES-09** Removing every permission from a role is allowed, and its holders see only "not allowed" messages.
- **P2-ROLES-10** Reset to defaults restores the bundle from code, is audited with what changed, and does nothing to custom roles.
- **P2-ROLES-11** Edits survive db:sync-rbac and deployments; a brand-new permission reaches its default roles.
- **P2-ROLES-12** A permission removed from the code disappears from the page and from all roles.
- **P2-ROLES-13** A permission change applies on the user's next request, including open live-update streams.
- **P2-ROLES-14** An Admin removing their own ability to manage users follows the rule that only the Super Admin edits roles.
- **P2-ROLES-15** Permission codes appear only on this page, as small secondary text.

### User management screens

- **P2-UMGMT-01** Only allowed roles see the screens, and an Admin never gets controls that touch a Super Admin.
- **P2-UMGMT-02** The role picker hides Super Admin from an Admin, and the server refuses it anyway.
- **P2-UMGMT-04** The Admin's employee page lists employees; clicking a record opens that person's details to view and edit.
- **P2-UMGMT-05** Setting a new password from the employee record works, shows a clear warning that the person will be signed out, and never displays the password afterwards.
- **P2-UMGMT-06** A manager or agent cannot open the employee page or another person's record by URL, and an Admin opening a Super Admin's record gets no edit or password controls.
- **P2-UMGMT-03** A user deactivated while they have open leads shows a clear warning, and their leads follow the rule in Phase 5. (Moved to Phase 5: leads do not exist until Phase 3, and the rule lives in Phase 5.)

---

## Phase 3: Lead core

### Leads and contacts

- **P3-LEAD-01** A new lead starts in stage New with no owner.
- **P3-LEAD-02** "Unassigned" means no owner: it is never a stage.
- **P3-LEAD-03** A lead cannot be created without a contact, and a phone is stored in E.164 only.
- **P3-LEAD-04** Indian numbers with spaces, dashes, a leading 0 or no country code are normalised; a too-short, too-long or letter-filled number is refused.
- **P3-LEAD-05** A foreign number with its own country code is kept correctly.
- **P3-LEAD-06** Creating a lead for an existing phone uses the existing contact, even when two requests arrive together.
- **P3-LEAD-07** A second open lead for the same contact follows a stated rule.
- **P3-LEAD-08** A won or lost customer who returns follows a stated rule: a new lead or reopening.
- **P3-LEAD-09** A soft-deleted lead disappears from every list, count, search and report, but history still resolves.
- **P3-LEAD-10** Restoring or re-enquiring from a soft-deleted or anonymised contact follows a stated rule.
- **P3-LEAD-11** Only a permitted role can delete a lead, and a lead with calls or messages is soft-deleted.
- **P3-LEAD-12** An agent can edit only leads in their scope, and an ownership field can never be changed through the ordinary edit route.
- **P3-LEAD-13** Two people editing one lead at once do not silently overwrite each other.
- **P3-LEAD-14** Budget accepts rupee values with two decimals, and refuses negative or absurd amounts.
- **P3-LEAD-15** Traveller count refuses zero, negatives and decimals.
- **P3-LEAD-16** A travel end date before the start date is refused; a past start date follows a stated rule; a one-day trip works.
- **P3-LEAD-17** Unknown custom fields are ignored or refused by a stated rule, and old leads still open when custom fields change.
- **Q-05 (needs an answer):** Does a returning customer reopen the old lead or start a new one?

### Pipeline stages

- **P3-STAGE-01** Stage changes are audited with who, when, from and to.
- **P3-STAGE-02** Moving to Lost needs a reason; moving to Won or Lost sets the closed time.
- **P3-STAGE-03** Reopening a closed lead clears the closed time and follows a stated permission rule.
- **P3-STAGE-04** A stage that does not exist is refused, and an inactive stage cannot be newly chosen but old leads keep showing it.
- **P3-STAGE-05** A stage in use cannot be deleted.
- **P3-STAGE-06** Reordering stages changes display and funnel, not lead history.
- **P3-STAGE-07** Skipping stages follows a stated rule.
- **P3-STAGE-08** A stage change to the same stage does nothing and writes no audit event.

### Notes, tasks and follow-ups

- **P3-NOTE-01** A note cannot be empty, and an author is shown even after they are deactivated.
- **P3-NOTE-02** Notes follow a stated edit and delete rule.
- **P3-NOTE-03** A task needs a title, a due date and an assignee in the lead's scope, and an inactive user cannot be assigned.
- **P3-NOTE-04** Overdue changes exactly at business midnight, not UTC midnight.
- **P3-NOTE-05** A task due today is not overdue until the business day ends.
- **P3-NOTE-06** Completing a task twice does nothing more, and reopening follows a stated rule.
- **P3-NOTE-07** A task on a lead that gets reassigned follows a stated rule about its assignee.
- **P3-NOTE-08** A follow-up date in the past follows a stated rule.
- **P3-NOTE-09** Tasks and follow-ups of a closed lead stop reminding.

### Timeline

- **P3-TL-01** Every event appears exactly once, even if its source event is delivered twice.
- **P3-TL-02** Events show in true time order, even when they arrive out of order.
- **P3-TL-03** An item whose author or source is gone still shows sensibly.

### Lead screens

- **P3-LSCREEN-01** Agents see own leads, managers team leads, and view-all roles all leads, in the list, detail, search and counts.
- **P3-LSCREEN-02** Opening another agent's lead by URL says "not found".
- **P3-LSCREEN-03** Search by phone works in any format, and by name in any case, without exposing out-of-scope leads.

### System settings

- **P3-SET-01** Default settings exist after seeding, and running the seed twice does not reset edited values.
- **P3-SET-02** A setting with the wrong type or an out-of-range value, such as a negative timeout, is refused.
- **P3-SET-03** A changed setting applies to new work, and its effect on work already running is stated.
- **P3-SET-04** Each setting change is audited with its old and new values.

---

## Phase 4: WhatsApp

### Webhook and duplicates

- **P4-WEBHOOK-01** A valid signed message is stored and answered quickly, with the work done in a job.
- **P4-WEBHOOK-02** A missing, wrong or expired signature is refused and stored as nothing; the raw body is checked exactly as received.
- **P4-WEBHOOK-03** The verification handshake works with the right token and is refused otherwise.
- **P4-WEBHOOK-04** The same message delivered twice, or at the same moment, creates one record.
- **P4-WEBHOOK-05** A malformed or unknown webhook body is accepted safely and logged, without crashing or endless retries.
- **P4-WEBHOOK-06** A single webhook with several messages or statuses handles all of them, including if one fails.
- **P4-WEBHOOK-07** Status updates arriving before their message, or out of order (read before delivered), never move the status backward.
- **P4-WEBHOOK-08** A status for an unknown message is handled safely.
- **P4-WEBHOOK-09** If the database is down during a webhook, the provider gets an error so it retries, and nothing is lost.
- **P4-WEBHOOK-10** A burst of many messages is processed without losing any.
- **P4-WEBHOOK-11** Very large or slow webhook bodies do not harm the server.

### Incoming messages

- **P4-INBOUND-01** A first message creates one contact, one lead and one conversation, even if two arrive together.
- **P4-INBOUND-02** A second message from the same number stays on the same lead.
- **P4-INBOUND-03** A message from a customer with a closed lead follows the Phase 3 returning-customer rule.
- **P4-INBOUND-04** Text, image, document, audio, video, location, contact, reaction, reply, button and unsupported types each show sensibly.
- **P4-INBOUND-05** Emoji-only, very long and non-English messages display correctly.
- **P4-INBOUND-06** Messages show in the time they were sent, even if they arrive late or out of order.
- **P4-INBOUND-07** A customer with no profile name still creates a lead; a changed profile name does not overwrite a name typed by staff.
- **P4-INBOUND-08** A message from the business number itself, or a group, does not create a lead.
- **P4-INBOUND-09** An owner's unread count is correct under simultaneous messages and reads.
- **P4-INBOUND-10** A message on a lead whose owner is deactivated still reaches someone, per the stated rule.

### 24-hour window and sending

- **P4-WINDOW-01** A free-form reply 23 hours 59 minutes after the customer's last message is allowed.
- **P4-WINDOW-02** At exactly 24 hours and after, it is refused by the server with a friendly message, and templates are offered.
- **P4-WINDOW-03** The window starts from the customer's last inbound message, not from the agent's reply.
- **P4-WINDOW-04** A customer's new message reopens the window immediately on screen.
- **P4-WINDOW-05** A message started inside the window and sent after it closes is refused.
- **P4-WINDOW-06** Sending to a contact with no opt-in, or who opted out, is refused for templates.
- **P4-WINDOW-07** An opt-out message from the customer is recorded, and the rule for keywords is stated.
- **P4-WINDOW-08** Opt-in records its source and time, and is not overwritten by accident.
- **P4-WINDOW-09** An agent can only message leads in their scope.
- **P4-WINDOW-10** Double-clicking Send sends one message.
- **P4-WINDOW-11** A provider failure shows a friendly failed state with a retry, and retrying does not send twice.
- **P4-WINDOW-12** A message the provider says failed later is marked failed on screen.
- **P4-WINDOW-13** An empty message is refused, and an over-long one follows the WhatsApp limit.
- **P4-WINDOW-14** Rate limits from the provider slow sending down without losing messages.

### Templates

- **P4-TMPL-01** Only an approved template in the right language can be sent.
- **P4-TMPL-02** Every template variable must be filled, and a missing or extra variable is refused.
- **P4-TMPL-03** A template that becomes rejected or paused stops being offered, and an in-flight send fails friendly.
- **P4-TMPL-04** Duplicate name and language is refused.
- **P4-TMPL-05** Only a permitted role manages templates.

### Media

- **P4-MEDIA-01** Received media is saved through file storage with a key containing no personal data.
- **P4-MEDIA-02** A download that fails or expires is retried, then shows a clear placeholder, and the message remains.
- **P4-MEDIA-03** An oversized or disallowed file type is handled safely and never run.
- **P4-MEDIA-04** Only people who can see the lead can open its media.
- **P4-MEDIA-05** Sending a file over the WhatsApp limit is refused with a friendly message.

### Duplicates and merging

- **P4-MERGE-01** Formats of the same number (+91, 91, 0, spaces) all resolve to one contact.
- **P4-MERGE-02** Two leads being merged keep all notes, tasks, messages, calls and history, with one survivor.
- **P4-MERGE-03** A merge while one lead is mid-call or in a blast pool follows a stated rule.
- **P4-MERGE-04** Merging twice does nothing more, and a merge is audited.
- **Q-06 (needs an answer):** Do agents need SMS as well as WhatsApp?
- **Q-07 (needs an answer):** Which WhatsApp route: direct Meta API or a provider (Decision 19)?
- **Q-08 (needs an answer):** What opt-out words count, and how is opt-in captured?

### Gateway

- **P4-GATE-01** The fake gateway and every real one pass the same contract tests, and tests never call a real API.
- **P4-GATE-02** A provider outage shows a friendly message, and retried work is not lost or duplicated.

---

## Phase 5: Manager queue and assignment engine

### Queue and preview

- **P5-QUEUE-01** The queue lists only unassigned, non-deleted leads in the manager's scope.
- **P5-QUEUE-02** A preview changes nothing and shows exactly who would get what.
- **P5-QUEUE-03** A lead assigned by someone else between preview and confirm is refused or skipped by a stated rule, and the manager is told.
- **P5-QUEUE-04** An agent who becomes ineligible between preview and confirm follows a stated rule.
- **P5-QUEUE-05** A manager cannot assign to agents outside their team, or leads outside their scope.
- **P5-QUEUE-06** No leads, or no eligible agents, gives a friendly message and changes nothing.
- **P5-QUEUE-07** Assigning a single lead, a selected list, and "all unassigned" all work; "all" means what the preview showed, not leads that arrived later.
- **P5-QUEUE-08** Bulk assignment is all-or-nothing, with no partial result on failure.
- **P5-QUEUE-09** A very large batch completes without timing out or holding locks too long.
- **P5-QUEUE-10** Two managers assigning the same leads at once give each lead one owner.
- **P5-QUEUE-11** The same request sent twice does nothing the second time, and the same idempotency key with different content is refused.
- **P5-QUEUE-12** New leads appear in the queue live, and assigned ones disappear for all managers.

### Assignment modes

- **P5-MODE-01** Manual: each lead goes to the chosen agent, who must be eligible.
- **P5-MODE-02** Round-robin: counts differ by at most one, and the rotation continues fairly across batches rather than always starting with the same agent.
- **P5-MODE-03** Least-loaded: each lead goes to the agent with the fewest open leads, recounting during the batch; ties go to the longest idle, and never-assigned agents have a stated place.
- **P5-MODE-04** Priority by tier: senior agents fill up to their cap before others, and overflow goes to the next tier.
- **P5-MODE-05** Priority by value: the highest-value leads go to top agents, with stated handling for no budget and equal values.
- **P5-MODE-06** Random: only eligible agents are chosen, and tests use a fixed seed.
- **P5-MODE-07** More leads than total capacity: the rest stay unassigned, and the manager is told how many.
- **P5-MODE-08** One eligible agent, or one lead, works in every mode.
- **P5-MODE-09** Closed leads do not count toward open load.

### Eligibility

- **P5-ELIG-01** Inactive, deactivated and invited agents are never chosen.
- **P5-ELIG-02** An agent on leave is skipped, including on the first and last day of leave in the business timezone.
- **P5-ELIG-03** An agent off shift is skipped when shifts are configured; no shifts configured means always available.
- **P5-ELIG-04** A shift crossing midnight and a shift's exact start and end minutes follow a stated rule.
- **P5-ELIG-05** An agent at their cap is skipped, and a personal cap overrides the default; a cap of zero means no leads.
- **P5-ELIG-06** Language and destination filters match correctly, and a lead with no language or destination follows a stated rule.
- **P5-ELIG-07** A user who is not an agent role cannot be assigned, and that test uses permissions rather than role names.
- **Q-09 (needs an answer):** Can a shift cross midnight, and is it counted to the starting day?

### Blast pool

- **P5-BLAST-01** Each lead has only one open pool entry.
- **P5-BLAST-02** Only eligible agents see and can claim a pool entry.
- **P5-BLAST-03** Two, or many, agents claiming at the same moment: exactly one wins, and the others get the friendly "already taken" message.
- **P5-BLAST-04** Claiming twice by the winner does nothing more.
- **P5-BLAST-05** A claim at the moment of expiry has exactly one outcome: claimed or expired, never both.
- **P5-BLAST-06** An agent who becomes ineligible, reaches their cap or is deactivated after the blast cannot claim.
- **P5-BLAST-07** Cap checks hold when one agent claims many leads at once.
- **P5-BLAST-08** Nobody claims: the entry expires and the lead returns to the queue or escalates per settings.
- **P5-BLAST-09** A manager cancels a pool entry while someone claims: one clear outcome.
- **P5-BLAST-10** A pool lead assigned manually or deleted leaves the pool for everyone.
- **P5-BLAST-11** A claimed lead disappears for the other agents live, and works by polling too.
- **P5-BLAST-12** Blasting to zero eligible agents is refused.

### Timeouts and reassignment

- **P5-TIMEOUT-01** An untouched lead returns to the pool or escalates exactly at its deadline, per settings.
- **P5-TIMEOUT-02** What counts as an agent action (reply, call, note, stage change) is listed, and each cancels the timeout.
- **P5-TIMEOUT-03** An action at the same moment as the timeout has one clear result.
- **P5-TIMEOUT-04** A delayed job that arrives after the lead was reassigned or closed does nothing.
- **P5-TIMEOUT-05** A lost delayed job is caught by the sweeper, and both running together act once.
- **P5-TIMEOUT-06** A lead that keeps timing out does not bounce forever: the limit is stated.
- **P5-TIMEOUT-07** A timeout with no eligible agents left follows a stated rule.
- **P5-TIMEOUT-08** Timeouts during the worker's downtime are handled on return, without a flood of duplicates.
- **P5-TIMEOUT-09** Whether timeouts pause outside business hours or shifts is stated.
- **P5-TIMEOUT-10** A settings change does not change the deadlines already set, unless stated.

### Reassignment and leaving staff

- **P5-REASSIGN-01** Reassigning needs its own permission, and a reason per the stated rule.
- **P5-REASSIGN-02** Reassigning to the current owner does nothing and writes no record.
- **P5-REASSIGN-03** An agent deactivated, on leave or leaving keeps no orphaned leads: the stated rule moves or flags them, including their tasks, pool entries, pending timeouts and conversations.
- **P5-REASSIGN-04** Follow-up tasks, conversation owner and the live screens all follow the lead to its new owner.
- **P5-REASSIGN-05** The old owner loses access immediately after reassignment, except by scope, including an open screen.
- **P5-REASSIGN-06** Every ownership change records actor, previous owner, new owner, mode, reason and time.
- **P5-REASSIGN-07** Auto-assign, if on, applies to new leads once and never overrides a manager's choice; only one active rule exists.
- **Q-10 (needs an answer):** When an agent is deactivated, what happens to their open leads?
- **Q-11 (needs an answer):** Do timeouts pause overnight or outside shifts?
- **Q-12 (needs an answer):** How many times may a lead time out before it goes to a manager?

---

## Phase 6: Agent workspace

### My leads and the lead record

- **P6-WORK-01** "My leads" shows only the agent's leads, and quick filters match their counts.
- **P6-WORK-02** A lead reassigned while open shows a clear notice and stops allowing edits.
- **P6-WORK-03** A new lead, claim or message appears live without losing what the agent is typing.
- **P6-WORK-04** An unsaved note or form warns before leaving, and a save failure keeps the text.
- **P6-WORK-05** Two tabs on the same lead stay consistent.
- **P6-WORK-06** The chat panel loads older messages without losing position, and new ones do not jump the page.
- **P6-WORK-07** Keyboard shortcuts do not fire while typing.
- **P6-WORK-08** The call outcome form cannot be submitted twice, requires what the rules require, and can be filled in later.
- **P6-WORK-09** An agent with no leads, or with hundreds, gets a friendly and smooth screen.
- **P6-WORK-10** The pool list and claim button handle "already taken" gracefully.

---

## Phase 7: Browser calling and recordings

### Placing a call

- **P7-CALL-01** Clicking Call creates one call record with our own reference, and double-clicking does not place two calls.
- **P7-CALL-02** An agent already on a call cannot start another, and the same customer cannot be dialled twice by accident.
- **P7-CALL-03** No lead access, or no permission, means no call and no credentials.
- **P7-CALL-04** A lead with no phone, an invalid phone or an anonymised contact cannot be called.
- **P7-CALL-05** Microphone denied, no microphone, or a device unplugged mid-call each give a friendly message.
- **P7-CALL-06** Browser credentials are short-lived, per agent, never logged, and refused for another agent.
- **P7-CALL-07** An expired credential is renewed, or the agent is told clearly.
- **P7-CALL-08** If browser calling fails and the provider supports it, "call via my phone" is offered, otherwise a friendly message.
- **P7-CALL-09** Provider unreachable: a friendly failure, and the call record ends as failed rather than stuck.
- **P7-CALL-10** A call the agent gives up on before connecting is recorded as cancelled.
- **P7-CALL-11** Busy, no answer, wrong number, rejected and failed each end with the correct status.

### During a call

- **P7-CALLLIVE-01** The call card moves through dialling, ringing, connected with a timer, and ended, and matches server events.
- **P7-CALLLIVE-02** Mute, hold and keypad tones work, and refusal by the provider gives a friendly message.
- **P7-CALLLIVE-03** The network dropping mid-call shows a clear state, and the call ends cleanly if it cannot recover.
- **P7-CALLLIVE-04** Refreshing or closing the tab mid-call follows a stated rule, and the call record does not stay "in progress" forever.
- **P7-CALLLIVE-05** Signing out or a session ending mid-call follows a stated rule.
- **P7-CALLLIVE-06** A lead reassigned or an agent deactivated mid-call does not cut the call, and the record stays correct.
- **P7-CALLLIVE-07** A call that never gets an end event is closed by a sweeper with a clear status.
- **P7-CALLLIVE-08** The timer stays correct after the tab sleeps.

### Provider webhooks

- **P7-CALLHOOK-01** A bad signature is refused; a valid event is stored raw and processed in a job.
- **P7-CALLHOOK-02** The same event twice does nothing more.
- **P7-CALLHOOK-03** Events out of order (ended before answered) never move a call backward, and durations come out right.
- **P7-CALLHOOK-04** An event matches by our reference first, then by phone number; an event matching nothing is logged safely, and matching by phone cannot attach to the wrong lead.
- **P7-CALLHOOK-05** A phone number on several leads follows a stated rule.
- **P7-CALLHOOK-06** Unknown provider statuses map to a safe status and are logged.
- **P7-CALLHOOK-07** Each provider status maps to one of our statuses, with no provider name in CRM code.

### Inbound calls

- **P7-INCALL-01** A known customer rings their lead's owner if online, with a pop-up showing the lead.
- **P7-INCALL-02** Owner offline, busy, on leave or deactivated follows the fallback rule; no agent available logs a missed call and tells the manager.
- **P7-INCALL-03** An unknown number creates one lead with source Phone, even with two calls together.
- **P7-INCALL-04** Two agents cannot both answer the same call; a second answer attempt gets a friendly message.
- **P7-INCALL-05** The caller hanging up before an answer removes the pop-up and logs a missed call.
- **P7-INCALL-06** Missing the call, or being on another call, follows a stated rule.
- **P7-INCALL-07** A hidden or malformed caller number is handled safely.
- **P7-INCALL-08** A pop-up shows only what the agent may see.
- **P7-INCALL-09** Routing a slow webhook falls back so the caller is not left waiting.
- **Q-13 (needs an answer):** What does a caller hear out of hours, and who gets the missed-call alert?

### Recordings

- **P7-REC-01** A ready recording is downloaded, compressed to mono MP3, stored, and only its metadata saved.
- **P7-REC-02** The same "recording ready" twice stores it once.
- **P7-REC-03** An expired provider link marks it failed, alerts managers, and leaves the call log unchanged.
- **P7-REC-04** A failed download retries with backoff, and a failed conversion keeps the original or fails clearly per the stated rule.
- **P7-REC-05** A corrupt, empty or very long recording is handled safely.
- **P7-REC-06** A checksum mismatch is treated as a failure.
- **P7-REC-07** A worker crash mid-job leaves no partial file and can run again.
- **P7-REC-08** A call with no recording shows a clear state, not a broken player.
- **P7-REC-09** Playback needs both the permission and scope; refused otherwise, even with a guessed key or link.
- **P7-REC-10** A signed link expires as stated, and an expired link fails friendly.
- **P7-REC-11** Every playback is audited, and an agent without permission gets the friendly refusal.
- **P7-REC-12** Seeking and pausing work when the file is streamed.
- **P7-REC-13** A deleted recording shows "no longer available", and the call log stays.
- **P7-REC-14** Retention deletes exactly the expired files, and running it twice is safe; a file already gone is not an error.
- **P7-REC-15** Disk full or storage down fails friendly, retries, and alerts.
- **P7-REC-16** No audio bytes ever reach the database.

### Adapters and storage

- **P7-DRIVER-01** The fake provider and every real one pass the same contract tests with recorded webhook samples, and no test calls a real provider.
- **P7-DRIVER-02** Switching provider by setting needs no CRM code change, and older calls stay readable.
- **P7-DRIVER-03** A missing capability hides its feature, and the server refuses it too.
- **P7-DRIVER-04** Stored SIP logins are encrypted, never logged and never returned, and each agent has their own.
- **P7-DRIVER-05** The S3 driver passes the storage contract, and storage:copy can run twice safely and tolerates a failure midway.
- **Q-14 (needs an answer):** Which calling provider (Decision 30), and does it support licensed browser calling to Indian numbers?
- **Q-15 (needs an answer):** What is the exact recording announcement?

---

## Phase 8: Notifications and SLA

### Notifications

- **P8-NOTIF-01** A notification reaches only its intended user, live, and shows after a refresh.
- **P8-NOTIF-02** Marking one or all as read is safe to repeat, and the unread count stays correct.
- **P8-NOTIF-03** One event creates one notification, even if delivered twice.
- **P8-NOTIF-04** A notification linking to a record the user can no longer see says "not found" friendly.
- **P8-NOTIF-05** Notifications to a deactivated user are skipped.
- **P8-NOTIF-06** Email failure retries, and a bad address does not block others; email content contains no secrets.
- **P8-NOTIF-07** Push refused or expired is handled safely.
- **P8-NOTIF-08** Many events at once do not flood the user: the grouping rule is stated.

### SLA timers and reminders

- **P8-SLA-01** A first-response timer stops at the first genuine agent action, and the plan lists what counts.
- **P8-SLA-02** A reply at the exact deadline has one clear result.
- **P8-SLA-03** A reminder for a completed or reassigned task, or a closed lead, does not fire.
- **P8-SLA-04** Reassigning moves or restarts the timer by a stated rule.
- **P8-SLA-05** Daily reminders run once per business day at the business-timezone time, even if the worker restarts or was down.
- **P8-SLA-06** Weekends, holidays and out-of-hours handling are stated.
- **P8-SLA-07** Escalation fires once and reaches a manager; with no manager, it follows the stated fallback.
- **P8-SLA-08** A settings change does not double-fire timers already set.
- **Q-16 (needs an answer):** Should SLA clocks count only working hours? Are there holidays?
- **Q-17 (needs an answer):** Which notifications go by email or push, and can users turn them off?

---

## Phase 9: Reports and dashboards

### Numbers and scope

- **P9-REPORT-01** Each dashboard shows own, team or all according to permission, and a manager's totals never include other teams.
- **P9-REPORT-02** Every number matches a hand-counted test data set.
- **P9-REPORT-03** Daily buckets use the business day: 23:59 and 00:01 land on different days, including month and year ends.
- **P9-REPORT-04** A date range includes both ends in business days, and a from date after the to date is refused.
- **P9-REPORT-05** A range with no data shows zeros, not errors, and division by zero (such as conversion with no leads) is handled.
- **P9-REPORT-06** Soft-deleted leads are excluded, or included by a stated rule, consistently everywhere.
- **P9-REPORT-07** Deactivated agents still appear in historical numbers.
- **P9-REPORT-08** A lead reassigned during the period counts by a stated rule.
- **P9-REPORT-09** A reopened lead, or a merged one, is not double-counted.
- **P9-REPORT-10** Response time uses the stated definition, and leads with no response are handled.
- **P9-REPORT-11** Funnel counts stay right when stages are renamed, reordered or deactivated.
- **P9-REPORT-12** Filters combine correctly, and totals equal the sum of their parts.
- **P9-REPORT-13** Reports on realistic data volumes stay within the stated time limit.
- **P9-REPORT-14** Snapshots, if used, are correct and rebuildable, and running one twice is safe.

### Exports

- **P9-EXPORT-01** Exports contain exactly what the screen shows, in scope, and need their own permission.
- **P9-EXPORT-02** Exports are audited.
- **P9-EXPORT-03** Exports never include hashes, secrets or fields the person cannot see.
- **P9-EXPORT-04** A cell beginning with =, +, - or @ cannot run as a spreadsheet formula.
- **P9-EXPORT-05** Indian text and emoji open correctly in Excel.
- **P9-EXPORT-06** A very large export does not time out or harm the server; it runs as a job if needed.
- **P9-EXPORT-07** Export dates use the business timezone.
- **P9-EXPORT-08** An empty export is still valid.

---

## Phase 10: Audit, data protection and retention

### Audit views

- **P10-AUDV-01** Only permitted roles see the audit trail, within their scope.
- **P10-AUDV-02** Filters by person, record, action and date work, and a deactivated actor still shows.
- **P10-AUDV-03** The audit screens offer no edit or delete.
- **P10-AUDV-04** Reading a sensitive record or playing a recording is audited.

### Erasure, export and retention

- **P10-ERASE-01** Erasing a contact anonymises every personal field, in leads, messages, calls and recordings, and the row stays so history holds.
- **P10-ERASE-02** Erasure deletes files from storage, and a storage failure is retried until done, not silently skipped.
- **P10-ERASE-03** Erasure run twice is safe, and it cannot run on the wrong person.
- **P10-ERASE-04** An erased contact messaging again is treated as new, per a stated rule.
- **P10-ERASE-05** A contact with an active call or open lead follows a stated rule at erasure.
- **P10-ERASE-06** Search, reports, exports, logs and backups follow the stated erasure rules.
- **P10-ERASE-07** A data export request gives that person's data only, and only to a permitted role.
- **P10-ERASE-08** Consent records keep who, when and how, and withdrawing consent stops the related actions.
- **P10-ERASE-09** Each retention job (messages, recordings, webhook logs, sessions) deletes exactly what is past its date, in business time, safely twice, in small batches.
- **P10-ERASE-10** Records under a legal or open-case hold follow a stated rule.
- **P10-ERASE-11** Audit rows are kept or anonymised by a stated rule, and never break the append-only protection.
- **P10-ERASE-12** Privacy notices use APP_CONFIG values.
- **P10-ERASE-13** Logs are reviewed for personal data, with a test that the redaction list covers every sensitive field.
- **Q-18 (needs an answer):** How long must messages, recordings and audit records be kept? Are the proposed defaults right?
- **Q-19 (needs an answer):** What is the exact DPDP wording and process, confirmed by a legal adviser?

---

## Phase 11: Hardening, observability and performance

### Security

- **P11-SEC-01** A penetration test finds no access to another person's data by changing IDs.
- **P11-SEC-02** Security headers are set, and the rate limits hold across the sensitive routes.
- **P11-SEC-03** Scripts stored in names, notes or messages never run on any screen, export or notification.
- **P11-SEC-04** Upload and media handling cannot reach other files.
- **P11-SEC-05** Secrets never appear in the browser bundle, responses, logs or images.
- **P11-SEC-06** Dependencies have no known serious vulnerabilities.
- **P11-SEC-07** Test-only routes, cookies and jobs are unreachable in production, proven against a production build.

### Monitoring and resilience

- **P11-OBS-01** Failed and stuck jobs, a stopped worker and a full disk each raise an alert.
- **P11-OBS-02** Backups restore successfully, for both the database and recordings, in a timed drill.
- **P11-OBS-03** A database restart, a worker restart and an app restart each recover by themselves, and connection limits are not exhausted.
- **P11-OBS-04** Many open live-update connections stay stable under a load test.
- **P11-OBS-05** Load tests show the agreed speed at realistic data and user numbers, and slow queries are indexed.
- **P11-OBS-06** A two-instance setup does not double-run jobs, and live events reach users on either instance.
- **P11-OBS-07** Accessibility checks pass on every main screen.

---

## Phase 12: Production deployment

### Deployment and operations

- **P12-DEPLOY-01** A failed migration stops the rollout, and the previous version keeps running.
- **P12-DEPLOY-02** A migration works with the previous app version, so a rollback is safe.
- **P12-DEPLOY-03** A rollback leaves the data usable, by a tested procedure.
- **P12-DEPLOY-04** RBAC sync runs on every deploy and keeps edited grants.
- **P12-DEPLOY-05** The first Super Admin is created by the private seed, never through the repository.
- **P12-DEPLOY-06** Secrets come only from the secret store, and starting with a missing or placeholder secret fails clearly.
- **P12-DEPLOY-07** HTTPS is forced, the microphone works, and live updates pass the proxy without buffering.
- **P12-DEPLOY-08** The worker keeps running through an app deploy, and jobs in progress are not lost.
- **P12-DEPLOY-09** Fake providers cannot be selected in production.
- **P12-DEPLOY-10** Off-server backups and disk alerts are on before go-live.
- **P12-DEPLOY-11** An expired HTTPS certificate or a full disk is caught by monitoring first.
- **P12-DEPLOY-12** Webhook URLs for WhatsApp and the calling provider are set and verified after deployment.

---

## Phase 13: Future: WhatsApp calling (only if chosen)

### WhatsApp calling

- **P13-WACALL-01** The same call log, recording, consent and permission rules apply as for browser calling.
- **P13-WACALL-02** Calling permission from the customer is requested and recorded before any call, and refused otherwise.
- **P13-WACALL-03** A customer's WhatsApp call rings the lead's owner, or follows the same fallback rules.
- **P13-WACALL-04** The feature can be switched off without affecting ordinary calls.
- **Q-20 (needs an answer):** Which of the three routes in Decision 18, and at what cost?

---

## All open questions for the owner

Collected from the sections above. Answer a phase's questions before planning it, then log each answer in `decision_log.md` and update the scenario.

| ID | Phase | Question |
|:---|:---|:---|
| Q-03 | 2 | Answered: whole chain below a person (Decision 55) |
| Q-04 | 2 | Answered: yes, several teams (Decision 55) |
| Q-05 | 3 | Does a returning customer reopen the old lead or start a new one? |
| Q-06 | 4 | Do agents need SMS as well as WhatsApp? |
| Q-07 | 4 | Which WhatsApp route: direct Meta API or a provider (Decision 19)? |
| Q-08 | 4 | What opt-out words count, and how is opt-in captured? |
| Q-09 | 5 | Can a shift cross midnight, and is it counted to the starting day? |
| Q-10 | 5 | When an agent is deactivated, what happens to their open leads? |
| Q-11 | 5 | Do timeouts pause overnight or outside shifts? |
| Q-12 | 5 | How many times may a lead time out before it goes to a manager? |
| Q-13 | 7 | What does a caller hear out of hours, and who gets the missed-call alert? |
| Q-14 | 7 | Which calling provider (Decision 30), and does it support licensed browser calling to Indian numbers? |
| Q-15 | 7 | What is the exact recording announcement? |
| Q-16 | 8 | Should SLA clocks count only working hours? Are there holidays? |
| Q-17 | 8 | Which notifications go by email or push, and can users turn them off? |
| Q-18 | 10 | How long must messages, recordings and audit records be kept? Are the proposed defaults right? |
| Q-19 | 10 | What is the exact DPDP wording and process, confirmed by a legal adviser? |
| Q-20 | 13 | Which of the three routes in Decision 18, and at what cost? |
