# Explore Hills CRM: The Story and What the Platform Contains

A plain-language walkthrough of how every user works with the platform at Explore Hills. (Updated 2026-10-29: agents call from the browser, recordings are kept in our own storage, and a Super Admin controls roles and permissions.)

## The people involved

Explore Hills is a travel company. The people in this story are:

- **Riya** is a customer who wants a Kashmir trip.
- **The owner** is the Super Admin. Only the Super Admin can create roles and decide what each role (including Admin) is allowed to do.
- **Mr. Sharma** is the manager. He hands out leads and watches the team.
- **Anil, Priya and Karan** are sales agents.
- **The calling provider** is a third-party phone service (Exotel, Knowlarity or similar). Explore Hills is still comparing providers on cost; the platform works with whichever one is chosen.

## The story: a day at Explore Hills

### Scene 1: Enquiries arrive overnight

Riya sees Explore Hills' ad and sends a WhatsApp message: "Kashmir trip in December for 4 people, what's the price?" She uses ordinary WhatsApp and never sees our platform.

By morning, 20 people like Riya have messaged. Our platform catches each message and creates a lead card with her name, phone number, message and time. If the same person messages twice, it stays one lead.

### Scene 2: The manager distributes the leads

Mr. Sharma opens the platform and sees a screen called **Manager queue**: "20 new enquiries, unassigned." He picks how to hand them out:

- **Round-robin:** 4 leads each, in turn.
- **Priority:** big-budget leads go to Priya, the best closer.
- **Blast:** all 20 go into a shared pool, and whoever taps **Accept** first gets each one.
- **Least busy:** leads go to whoever has the fewest open leads.

He sees a preview of who gets what, taps confirm, and it's done. Today he picks blast. Anil taps Accept on Riya's lead first, and it disappears from everyone else's pool.

### Scene 3: The agent works the lead

Anil opens **My leads** and sees Riya's lead card with her message and phone number. He has two ways to reach her.

**By chat.** He types a WhatsApp reply inside the platform: "Hi Riya, I'm Anil from Explore Hills, can I call you now?" She sees it in her normal WhatsApp, and the whole conversation stays on her lead.

**By call.** He clicks the **Call** button and talks to Riya **in the browser** with his headset. No desk phone or mobile is needed. The calling provider connects the call to Riya's phone and records it. While they talk, Riya's lead shows a live call card: ringing, connected, and a running timer.

If Riya calls Explore Hills' number herself, Anil's screen pops up her lead and the call rings in his browser, because he owns her lead.

### Scene 4: The platform records the call details

When the call ends, the provider sends our platform a message: "6-minute call, answered, here's the recording." The platform automatically adds this to Riya's lead timeline. In the background it downloads the recording, shrinks it to a small audio file (about 1 MB for 6 minutes), and keeps it in Explore Hills' own storage. Managers can play it from the lead; agents cannot, unless the Super Admin allows it.

Anil then fills a short form on the same lead: Kashmir, December 10–16, 4 people, ₹1.5 lakh budget, status "Quote to send", follow-up tomorrow. Everything about Riya now lives in one place.

### Scene 5: What if an agent is slow?

Karan accepted a lead but hasn't touched it for 30 minutes. The platform returns the lead to the pool or alerts Mr. Sharma, depending on his settings. No lead gets forgotten.

### Scene 6: End of day

Mr. Sharma opens reports: leads received, how many assigned, calls made, quotes sent, bookings won, and each agent's numbers.

### Later (optional): Riya calls on WhatsApp directly

If Explore Hills switches on WhatsApp calling, Riya can tap the call button in WhatsApp. The platform recognises her number and rings Anil, who already owns her lead. This is planned for a later phase. For now, customers message on WhatsApp or call the business number.

## What our platform contains

Think of three separate things:

- **WhatsApp (Meta)** is the mailbox where customers write.
- **The calling provider** is the phone line.
- **Our platform** is the control room that connects both and keeps all the records.

| Part | What it does | Who builds or provides it |
| --- | --- | --- |
| WhatsApp chat inbox | Receive and reply to customer messages inside the platform | We build the screens. Meta provides the messaging. |
| Lead and CRM records | Lead card, timeline, trip details, pipeline stages, follow-ups | We build |
| Manager queue | Shows unassigned enquiries and assigns them in bulk | We build |
| Assignment engine | Round-robin, priority, blast, least-busy, random, and timeouts | We build (the heart of the product) |
| Agent workspace | My leads, chat, call button, disposition form | We build |
| Browser phone, call button and call logging | The agent talks in the browser; the call card, duration, outcome and recording are saved to the lead | We build the connection (works with any provider) |
| The actual phone call | Connecting the browser to the customer's phone, recording audio | The third-party calling provider |
| Recording storage | Keeps the compressed recordings (cloud storage or our own server) | We build the connection; the storage place is chosen later |
| Reports and settings | Dashboards, users, teams, rules | We build |
| Roles & Permissions page | Super Admin creates roles and ticks what each role may do | We build |
| Background worker and live updates | Timeouts, reminders, recording downloads; screens that update without refreshing | We build |

## Chat or call?

- **Chat is inside the platform.** Agents read and send WhatsApp messages there.
- **Calls happen in the platform, in the browser, but are carried by the provider.** We don't build a phone system. We build the browser phone screen, the button and the automatic record-keeping. Changing provider later does not change the CRM.
- **WhatsApp voice calls are optional and later.**

## Who sees what

| User | What they use |
| --- | --- |
| Customer | Only WhatsApp and their phone, never our platform |
| Super Admin | Everything, plus the Roles & Permissions page |
| Admin | Users, settings, templates, reports (whatever the Super Admin allows) |
| Manager | Manager queue, assignment rules, team view, reports, call recordings |
| Agent | My leads, chat, browser calling, lead form |
| Our team | Setup, support, and keeping the connections to Meta and the calling provider running |
