# Claude Design Prompt

The prompt the owner gives to Claude Design, with a visual reference attached, to design every CRM screen. Everything below the line is the prompt.

---

# Design the complete UI for "Explore Hills CRM"

Design every screen below as a high-fidelity, responsive web app, in both **desktop (1440px)** and **mobile (390px)** views, plus tablet (768px) where the layout changes. Use one consistent design system across all screens.

## Reference

I have attached a reference. Follow its visual style closely: colour feel, typography, spacing, corner radius, density, navigation pattern and component style. Do not copy its logo, brand name or text. Where the reference doesn't cover something, extend its style consistently.

## The product

Explore Hills is a travel company. Customers enquire on WhatsApp, and each enquiry becomes a lead. A manager hands leads out to sales agents. Agents chat on WhatsApp and call customers from the browser, all from the lead's page. It is a daily work tool, used for hours at a time, so it must be fast to scan, calm and dense without feeling cramped.

Customers never see this app. It is for staff only.

## Who uses it

| Role        | What they do                              | Navigation they see                                                                                 |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Super Admin | Everything, plus roles and permissions    | All items, plus Roles & Permissions                                                                 |
| Admin       | Employees, settings, templates, reports   | Dashboard, Leads, Inbox, Queue, Employees, Teams, Templates, Reports, Audit, Settings, Diagnostics  |
| Manager     | Assigns leads, watches the team, reads reports | Dashboard, Queue, Team leads, Inbox, Team, Reports                                             |
| Agent       | Works their own leads: chat, calls, notes | My leads, Blast pool, Inbox, Follow-ups, My numbers                                                 |

Show how navigation adapts per role. Controls a person cannot use are hidden, not shown disabled.

## Screens to design

### 1. Sign-in and shell

1. **Sign-in:** email, password, show/hide password. There is **no "Forgot password" link and no sign-up**. Add the small text "Forgot your password? Ask your admin." Include the states: wrong credentials, too many attempts, submitting.
2. **App shell:** sidebar on desktop; on mobile, a top bar plus a bottom tab bar with at most 5 items and a "More" sheet. Includes the user's name and role, sign-out, a notification bell with unread count, global search, and a small live-connection indicator.
3. **Notifications panel:** new lead, claimed lead, SLA warning, missed call, follow-up due.
4. **Global search:** results by name and phone, grouped by leads and employees.

### 2. Dashboards

5. **Agent "My numbers":** own open leads, follow-ups due today, overdue, calls today, quotes sent, bookings won.
6. **Manager dashboard:** unassigned count, team's open leads, response times, per-agent table, leads needing attention.
7. **Admin / Super Admin dashboard:** company-wide volume, conversion funnel (New → Contacted → Qualified → Quote sent → Booked / Lost), team comparison.

### 3. Leads

8. **Leads list:** table on desktop, cards on mobile. Columns: customer, phone, destination, travel dates, travellers, budget, stage, owner, last activity, next follow-up, source. Sort on every column; filters for stage, owner, source, destination and dates; quick filters; saved filter chips; bulk select for managers.
9. **Create lead:** form with validation messages.
10. **Lead detail, the most important screen.** Desktop uses three panes:
    - Left: customer and trip details (destination, dates, travellers, budget, custom fields), stage selector, owner.
    - Centre: tabs or a combined timeline of messages, calls, notes, assignments, stage changes.
    - Right: WhatsApp chat panel.
    - Mobile: stacked tabs (Chat, Details, Timeline, Tasks), with sticky Call and Message actions.
11. **Live call card on the lead:** dialling → ringing → connected with a running timer → ended, with mute, hold, keypad and hang up. Also a persistent mini call bar while navigating elsewhere.
12. **Call outcome form** after a call: outcome, notes, next follow-up date, new stage.
13. **Incoming call pop-up:** caller's name, lead summary, answer and decline; plus the unknown-number version and a missed-call state.
14. **Softphone connection states:** microphone permission needed, microphone denied, connection lost, and the "Call via my phone" fallback.
15. **Recording player** in the call's timeline entry: play, seek, duration. Include "no longer available", "processing" and "failed" states, plus the view for an agent who has no access.
16. **Notes and tasks:** add note, add task, due date, overdue and completed states.
17. **Lost reason dialog** when moving a lead to Lost.
18. **Reassign dialog:** choose an agent, enter a reason.

### 4. WhatsApp inbox

19. **Inbox:** conversation list with unread counts, assigned to me/team filters and search, beside the chat. On mobile, list and chat are separate screens.
20. **Chat:** text, image, document, audio, video, template and unsupported message types; sent, delivered, read and failed states with retry.
21. **24-hour window:** while open, a normal composer with a small countdown. Once closed, the composer is replaced by "The 24-hour reply window has closed. Send an approved template." with a template picker.
22. **Template picker:** search, preview, fill in variables, and the "no opt-in recorded" blocked state.

### 5. Manager queue and assignment

23. **Manager queue:** "20 new enquiries, unassigned". Select one, many or all, with new leads arriving live.
24. **Assign flow:** a stepper or side panel: (1) choose a mode: Manual, Round-robin, Least busy, Priority, Random, Blast; (2) choose eligible agents, showing each one's open leads, cap, shift and leave status; ineligible agents are shown greyed with the reason; (3) **Preview** who gets what; (4) confirm, then a success summary.
25. **Assignment problems:** more leads than capacity ("6 leads stay unassigned"), no eligible agents, and "a lead was just assigned by someone else".
26. **Blast pool (agent view):** cards with a big Accept button, a time-left indicator, and the "already taken" state as a lead disappears live.
27. **Assignment rules and agent settings:** timeouts, caps, priority tiers, shifts by weekday, leave dates, language and destination.

### 6. Follow-ups

28. **Follow-ups:** Overdue, Today, Upcoming, Completed, in list form with quick complete.

### 7. People and access

29. **Employees list (Admin):** name, role, team, status, last sign-in; search, filters, add employee.
30. **Employee detail, opened by clicking a row:** view and edit details, role, team and manager; activate or deactivate. Show the warning "This person owns 14 open leads" when deactivating.
31. **Set password dialog (Admin only):** the admin sets a default password when creating an employee and can change it later, with a strength hint. Show the warning: "This person will be signed out of all devices." The password is never shown again after saving.
32. **Super Admin record viewed by an Admin:** no edit or password controls.
33. **Teams:** list, detail, manager, members.
34. **Roles & Permissions (Super Admin only):** role list with user counts; create, rename and delete custom roles; a permission editor grouped by module with a human-readable label and description. The permission code appears only here, as small secondary text. Include "Reset to defaults", the locked Super Admin role, and the "can't delete, users still hold this role" state.

### 8. Reports, audit and admin

35. **Reports:** volume, assignment, response time, conversion funnel, per-agent table, date range, export.
36. **Audit trail:** who, what, when, with filters. Read only.
37. **Templates:** list with approval status (Approved, Pending, Rejected), detail, create.
38. **Settings:** timeouts, caps, SLA, pipeline stages, recording retention, inbound call fallback.
39. **Diagnostics:** database, worker (up or down, last heartbeat), and live updates (live or polling).

### 9. System pages

40. **Friendly errors:** 404, 403 ("You don't have access to do this."), 500 with a small "Reference: abc123" line and a support contact, and an offline banner.

## Every list and form needs these states

Show loading skeletons, empty ("No leads yet"), no search results, error with retry, success toast, and submitting. Forms show friendly messages under each field.

## Rules the design must follow

- **Unassigned is not a stage.** A lead is unassigned when it has no owner, and that is shown separately from its stage.
- **Stages:** New, Contacted, Qualified, Quote sent, Booked, Lost. Use clear colours with a label, never colour alone.
- **Never show technical text:** no error codes, permission names (except on the Roles page), stack traces or IDs. Use plain, polite sentences.
- **Formats:** India. Dates like "1 Jan 2027", times like "12:05 am", currency like ₹1,50,000, phones like +91 98765 43210.
- **Text must handle** long names, Hindi text and emoji without breaking the layout.
- **Accessibility:** WCAG AA contrast, visible keyboard focus, touch targets of at least 44px on mobile, labelled icons.
- **Mobile is a real work view, not a shrunken desktop:** no sideways page scrolling, tables become cards, primary actions stay within thumb reach, dialogs become bottom sheets.
- **Desktop is keyboard friendly and dense:** tables with sticky headers and smooth scrolling.
- **Calm by default:** colour is reserved for status and primary actions. Live updates appear without jumping the page.

## Design system to deliver

Colour tokens (for light mode, and dark mode if the reference suggests it), typography scale, spacing, radius, shadows, and icons. Components: buttons, inputs, selects, date picker, tables, cards, tabs, badges, stage chips, avatars, dialogs, bottom sheets, toasts, stepper, chat bubbles, call card, and skeletons. Name them clearly so a developer can build them. The app will be built in Next.js with React.

Use a font that displays both English and Hindi well.

## Sample data

Use realistic, clearly fictional data:

- **Company:** Explore Hills. **Product:** Explore Hills CRM.
- **Manager:** Mr. Sharma. **Agents:** Anil, Priya, Karan.
- **Lead:** Riya Mehta, +91 90000 00001, "Kashmir trip in December for 4 people, what's the price?", WhatsApp source, Kashmir, 10–16 Dec 2026, 4 travellers, ₹1,50,000, Quote sent, next follow-up tomorrow.
- **Other leads:** Goa, Kerala, Ladakh, Manali, Andaman, with a mix of stages, owners and sources (WhatsApp, Phone, Website, Ad).

## Start with

First show the design system and these key screens on desktop and mobile: Sign-in, Lead detail, Manager queue with the assign flow, and Inbox. Then continue through all the remaining screens in the order above. Don't skip screens or states.
