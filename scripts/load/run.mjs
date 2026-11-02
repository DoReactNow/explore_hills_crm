// Drives the running app like 30 people at work, each with a live-update stream open, and reports speed
// against Decision 67. Then opens many live-update streams at once (P11-OBS-04).
// Usage: node scripts/load/run.mjs <base url> <seconds> <streams> <pause between actions, ms>
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const [BASE, SECONDS = "120", STREAMS = "300", THINK_MS = "2000"] = process.argv.slice(2);
const DATABASE_URL = process.env.DATABASE_URL;
const people = JSON.parse(readFileSync("scripts/load/.sessions.json", "utf8"));
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const samples = new Map();
const errors = new Map();
const record = (label, ms, status) => {
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
  if (status >= 400) errors.set(label, (errors.get(label) ?? 0) + 1);
};

async function hit(person, label, path, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        cookie: `eh_session=${person.token}`,
        origin: BASE,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    record(label, performance.now() - started, response.status);
    return response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  } catch {
    record(label, performance.now() - started, 599);
    return null;
  }
}

const ids = await db.query(
  `SELECT "ownerUserId" AS owner, array_agg(id) AS leads
   FROM (SELECT "ownerUserId", id, row_number() OVER (PARTITION BY "ownerUserId") AS n
         FROM leads_leads WHERE "ownerUserId" IS NOT NULL) x
   WHERE n <= 200 GROUP BY 1`,
);
const leadsOf = new Map(ids.rows.map((row) => [row.owner, row.leads]));
const anyLeads = ids.rows.flatMap((row) => row.leads);
// A manager sees only their own people's records, so that's all they ask for.
const reports = await db.query(
  `SELECT id, "managerId" FROM identity_users WHERE "managerId" IS NOT NULL`,
);
const teamOf = (managerId, byOwner) =>
  reports.rows
    .filter((row) => row.managerId === managerId)
    .flatMap((row) => byOwner.get(row.id) ?? []);
const chats = await db.query(
  `SELECT l."ownerUserId" AS owner, array_agg(c.id) AS chats
   FROM (SELECT id, "leadId", row_number() OVER (ORDER BY id) AS n FROM messaging_conversations) c
   JOIN leads_leads l ON l.id = c."leadId" WHERE c.n <= 5000 GROUP BY 1`,
);
const chatsOf = new Map(chats.rows.map((row) => [row.owner, row.chats]));
const anyChats = chats.rows.flatMap((row) => row.chats);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

const everyone = [
  [8, "page /leads", (p) => hit(p, "page /leads", "/leads")],
  [10, "GET leads list", (p) => hit(p, "GET leads list", "/api/leads?page=1")],
  [
    3,
    "GET leads search",
    (p) => hit(p, "GET leads search", "/api/leads?page=1&search=Customer%201234"),
  ],
  [10, "GET lead", (p, leads) => hit(p, "GET lead", `/api/leads/${pick(leads)}`)],
  [8, "GET conversations", (p) => hit(p, "GET conversations", "/api/conversations")],
  [
    8,
    "GET conversation",
    (p, _l, list) => hit(p, "GET conversation", `/api/conversations/${pick(list)}`),
  ],
  [4, "GET follow-ups", (p) => hit(p, "GET follow-ups", "/api/follow-ups")],
  [6, "GET notifications", (p) => hit(p, "GET notifications", "/api/notifications")],
  [4, "GET calls", (p) => hit(p, "GET calls", "/api/telephony/calls")],
  [4, "GET dashboard", (p) => hit(p, "GET dashboard", "/api/dashboard?range=7")],
  [6, "GET me", (p) => hit(p, "GET me", "/api/auth/me")],
  [
    4,
    "POST note",
    (p, leads) =>
      hit(p, "POST note", `/api/leads/${pick(leads)}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: "Load test note" }),
      }),
  ],
];
const managers = [
  [
    6,
    "report 30 days",
    (p) => hit(p, "report 30 days", `/api/reports?from=${monthAgo}&to=${today}`),
  ],
  [2, "report 1 year", (p) => hit(p, "report 1 year", `/api/reports?from=${yearAgo}&to=${today}`)],
  [5, "GET queue", (p) => hit(p, "GET queue", "/api/assignment/queue")],
];
const admins = [
  [3, "GET audit", (p) => hit(p, "GET audit", "/api/audit")],
  [2, "GET audit search", (p) => hit(p, "GET audit search", "/api/audit?search=created")],
  [
    2,
    "GET privacy search",
    (p) => hit(p, "GET privacy search", "/api/privacy/contacts?search=%2B919000"),
  ],
  [
    1,
    "export leads 1 year",
    (p) =>
      hit(p, "export leads 1 year", `/api/reports/export?kind=leads&from=${yearAgo}&to=${today}`),
  ],
  [1, "export audit", (p) => hit(p, "export audit", "/api/audit/export")],
];

const choose = (ops) => {
  let roll = Math.random() * ops.reduce((sum, op) => sum + op[0], 0);
  for (const op of ops) {
    roll -= op[0];
    if (roll <= 0) return op[2];
  }
  return ops[0][2];
};

const openStream = async (person, signal, onChunk) => {
  const response = await fetch(`${BASE}/api/events/stream`, {
    headers: { cookie: `eh_session=${person.token}` },
    signal,
  });
  if (!response.ok) throw new Error(`stream ${response.status}`);
  for await (const chunk of response.body) onChunk?.(Buffer.from(chunk).toString());
};

let peakConnections = 0;
const watcher = setInterval(async () => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
  );
  peakConnections = Math.max(peakConnections, rows[0].n);
}, 2000);

await db.query("SELECT pg_stat_reset()");

// Part 1: 30 people working.
const deadline = Date.now() + Number(SECONDS) * 1000;
const stop = new AbortController();
const streams = people.map((person) => openStream(person, stop.signal).catch(() => undefined));
await Promise.all(
  people.map(async (person, index) => {
    await new Promise((done) => setTimeout(done, index * 100));
    const ops =
      person.role === "AGENT"
        ? everyone
        : person.role === "MANAGER"
          ? [...everyone, ...managers]
          : [...everyone, ...managers, ...admins];
    const manager = person.role === "MANAGER";
    const leads = manager ? teamOf(person.id, leadsOf) : (leadsOf.get(person.id) ?? anyLeads);
    const list = manager ? teamOf(person.id, chatsOf) : (chatsOf.get(person.id) ?? anyChats);
    while (Date.now() < deadline) {
      await choose(ops)(person, leads, list);
      await new Promise((done) => setTimeout(done, Number(THINK_MS) * (0.5 + Math.random())));
    }
  }),
);
stop.abort();
await Promise.allSettled(streams);
const peakWorking = peakConnections;
peakConnections = 0;

// Part 2: many open streams, one notice to all of them.
const admin = people.find((person) => person.role === "ADMIN");
const manyStop = new AbortController();
const count = Number(STREAMS);
let opened = 0;
let received = 0;
let failed = 0;
const fanout = [];
let sentAt = 0;
const many = Array.from({ length: count }, (_, index) =>
  new Promise((done) => setTimeout(done, index * 10)).then(() =>
    openStream(admin, manyStop.signal, (text) => {
      if (text.includes("retry:")) opened += 1;
      if (text.includes("system.workerStatusChanged")) {
        received += 1;
        fanout.push(performance.now() - sentAt);
      }
    }).catch((error) => {
      if (error.name !== "AbortError") failed += 1;
    }),
  ),
);
await new Promise((done) => setTimeout(done, count * 10 + 5000));
const openedAll = opened;
const rounds = 5;
for (let round = 0; round < rounds; round += 1) {
  sentAt = performance.now();
  await db.query(`SELECT pg_notify('explorehills_events', $1)`, [
    JSON.stringify({ type: "system.workerStatusChanged", payload: { workerId: "load" } }),
  ]);
  await new Promise((done) => setTimeout(done, 6000));
}
const peakStreams = peakConnections;
const scans = await db.query(
  `SELECT relname AS table, seq_scan, seq_tup_read, idx_scan, n_live_tup AS rows
   FROM pg_stat_user_tables WHERE seq_tup_read > 0 ORDER BY seq_tup_read DESC LIMIT 12`,
);
manyStop.abort();
await Promise.allSettled(many);
clearInterval(watcher);
await db.end();

// The report.
const pct = (list, p) => list[Math.min(list.length - 1, Math.floor(list.length * p))];
const rows = [...samples.entries()]
  .map(([label, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const limit = label.startsWith("export") ? 60000 : label.startsWith("report") ? 3000 : 1000;
    return {
      label,
      requests: sorted.length,
      errors: errors.get(label) ?? 0,
      p50: Math.round(pct(sorted, 0.5)),
      p95: Math.round(pct(sorted, 0.95)),
      max: Math.round(sorted[sorted.length - 1]),
      limit,
      pass: pct(sorted, 0.95) <= limit && !errors.get(label),
    };
  })
  .sort((a, b) => b.p95 - a.p95);
const sortedFan = [...fanout].sort((a, b) => a - b);
const summary = {
  rows,
  scans: scans.rows,
  peakConnectionsWorking: peakWorking,
  streams: {
    asked: count,
    opened: openedAll,
    failed,
    expectedDeliveries: count * rounds,
    delivered: received,
    p95DeliveryMs: sortedFan.length ? Math.round(pct(sortedFan, 0.95)) : null,
    peakConnections: peakStreams,
  },
};
writeFileSync("scripts/load/.results.json", JSON.stringify(summary, null, 2));
console.table(rows);
console.table(scans.rows);
console.log(summary.streams, { peakConnectionsWorking: peakWorking });
process.exit(0);
