// P11-OBS-03, P11-OBS-06: two app instances and two workers on one database. Proves live events cross
// instances, jobs don't run twice and limits hold across both; then restarts the worker, the database and
// an app, and checks each recovers by itself. Uses the throwaway load database; restarts the local
// database container, so anything else using it sees a short outage.
import { execFileSync, spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import pg from "pg";

const PORTS = [47231, 47232];
const base = (port) => `http://127.0.0.1:${port}`;
const people = JSON.parse(readFileSync("scripts/load/.sessions.json", "utf8"));
const admin = people.find((person) => person.role === "ADMIN");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const LOGS = { w0: "/tmp/explorehills_drill_w0.log", w1: "/tmp/explorehills_drill_w1.log" };
const children = new Set();
let failures = 0;
const check = (name, good, detail = "") => {
  if (!good) failures += 1;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const env = (extra) => ({ ...process.env, LOG_LEVEL: "info", ...extra });
function start(command, args, extra, log) {
  const out = openSync(log, "a");
  const child = spawn(command, args, { env: env(extra), stdio: ["ignore", out, out] });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}
const startApp = (port) =>
  start(
    "npx",
    ["next", "start", "-p", String(port)],
    { APP_PORT: String(port) },
    `/tmp/explorehills_drill_app${port}.log`,
  );
const startWorker = (name) => start("node", ["dist/worker.js"], {}, LOGS[name]);

const authed = { cookie: `eh_session=${admin.token}` };
const json = async (port, path, init = {}) => {
  const response = await fetch(`${base(port)}${path}`, {
    ...init,
    headers: {
      ...authed,
      origin: process.env.APP_URL,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
};
async function until(what, test, seconds = 90) {
  const started = performance.now();
  while (performance.now() - started < seconds * 1000) {
    if (await test().catch(() => false)) return (performance.now() - started) / 1000;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const healthy = (port) => async () => (await fetch(`${base(port)}/api/health`)).status === 200;

function listen(port, onEvent) {
  const controller = new AbortController();
  const done = fetch(`${base(port)}/api/events/stream`, {
    headers: authed,
    signal: controller.signal,
  })
    .then(async (response) => {
      for await (const chunk of response.body) {
        const text = Buffer.from(chunk).toString();
        if (text.includes("event:")) onEvent(text);
      }
      return "closed";
    })
    .catch(() => "closed");
  return { stop: () => controller.abort(), done };
}

const connect = async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
};
const peak = { connections: 0 };

let apps = {};
let workers = {};
try {
  // --- Start two of everything.
  apps = { [PORTS[0]]: startApp(PORTS[0]), [PORTS[1]]: startApp(PORTS[1]) };
  await until("app 1", healthy(PORTS[0]));
  await until("app 2", healthy(PORTS[1]));
  workers = { w0: startWorker("w0"), w1: startWorker("w1") };
  await sleep(5000);
  const db = await connect();
  const client = { current: db };
  db.on("error", () => undefined);
  const watcher = setInterval(async () => {
    try {
      const { rows } = await client.current.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
      );
      peak.connections = Math.max(peak.connections, rows[0].n);
    } catch {
      /* the database is restarting */
    }
  }, 1000);

  // --- Live events cross instances, both ways (P11-OBS-06).
  for (const [from, to] of [PORTS, [...PORTS].reverse()]) {
    const seen = [];
    const stream = listen(to, (text) => seen.push(text));
    await sleep(1000);
    const started = performance.now();
    await client.current.query(`SELECT 1`);
    const { rows } = await client.current.query(
      `SELECT l.id FROM leads_leads l WHERE l."deletedAt" IS NULL ORDER BY l.id LIMIT 1`,
    );
    const note = await json(from, `/api/leads/${rows[0].id}/stage`, {
      method: "POST",
      body: JSON.stringify({ stageCode: "CONTACTED" }),
    });
    await json(from, `/api/leads/${rows[0].id}/stage`, {
      method: "POST",
      body: JSON.stringify({ stageCode: "NEW" }),
    });
    const arrived = await until("the event", async () => seen.length > 0, 10).catch(() => null);
    check(
      `a change on instance ${from} reaches a screen on instance ${to}`,
      arrived !== null,
      `change answered ${note.status}, arrived in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    stream.stop();
  }

  // --- A limit counts across instances (P11-SEC-02).
  await client.current.query(`DELETE FROM system_rate_limits`);
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const port = PORTS[i % 2];
    const response = await fetch(`${base(port)}/api/audit/export?from=2026-11-01&to=2026-11-01`, {
      headers: authed,
    });
    await response.text();
    statuses.push(response.status);
  }
  check(
    "the 10-a-minute export limit holds across both instances",
    statuses.filter((s) => s === 429).length === 2,
    statuses.join(" "),
  );

  // --- Jobs don't run twice (P11-OBS-06). Three minutes of every-minute jobs, on two workers.
  console.log("     waiting through 3 minutes of scheduled jobs on two workers");
  const since = new Date();
  await sleep(185_000);
  const slots = await client.current.query(
    `SELECT name, date_trunc('minute', created_on) AS slot, count(*)::int AS n FROM pgboss.job
     WHERE name IN ('assignment.sweep', 'telephony.sweep', 'notifications.sweep') AND created_on >= $1
     GROUP BY 1, 2`,
    [since],
  );
  check(
    "each every-minute job was created once per minute",
    slots.rows.length >= 6 && slots.rows.every((row) => row.n === 1),
    `${slots.rows.length} slots checked`,
  );
  const logged = [LOGS.w0, LOGS.w1].map((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes('"job completed"'))
      .map((line) => JSON.parse(line).jobId),
  );
  const all = logged.flat();
  check(
    "no job finished on two workers",
    new Set(all).size === all.length,
    `${all.length} runs, ${logged[0].length} and ${logged[1].length} per worker`,
  );
  check("both workers took work", logged[0].length > 0 && logged[1].length > 0);

  // --- Killing a worker outright (P11-OBS-03).
  workers.w0.kill("SIGKILL");
  workers.w1.kill("SIGKILL");
  await client.current.query(`DELETE FROM system_worker_heartbeats`);
  workers = { w0: startWorker("w0") };
  const workerBack = await until("the worker's heartbeat", async () => {
    const { body } = await json(PORTS[0], "/api/diagnostics");
    return body.data.worker.state === "up";
  });
  check("a killed worker comes back and reports in", true, `${workerBack.toFixed(1)} s`);

  // --- Restarting the database (P11-OBS-03). Nothing else is restarted.
  const seen = [];
  const stream = listen(PORTS[1], (text) => seen.push(text));
  await sleep(1000);
  await client.current.end().catch(() => undefined);
  execFileSync("docker", ["restart", "explorehills_local_db"], { stdio: "pipe" });
  const down = performance.now();
  const back = await until("the database through app 1", healthy(PORTS[0]), 120);
  await until("the database through app 2", healthy(PORTS[1]), 120);
  check(
    "both apps recover from a database restart unaided",
    true,
    `${back.toFixed(1)} s after it came back`,
  );
  const closed = await Promise.race([stream.done, sleep(20_000).then(() => "open")]);
  check("an open live screen is closed, so its browser reconnects", closed === "closed");
  stream.stop();
  client.current = await connect();
  client.current.on("error", () => undefined);
  const again = [];
  const second = listen(PORTS[1], (text) => again.push(text));
  await sleep(1000);
  await client.current.query(`SELECT pg_notify('explorehills_events', $1)`, [
    JSON.stringify({ type: "system.workerStatusChanged", payload: { workerId: "drill" } }),
  ]);
  const relayed = await until(
    "a live event after the restart",
    async () => again.length > 0,
    15,
  ).catch(() => null);
  check("live updates work again after reconnecting", relayed !== null);
  second.stop();
  const worked = await json(PORTS[0], "/api/leads?page=1");
  check("the app reads data again", worked.status === 200);
  const beat = await until(
    "the worker after the database restart",
    async () => {
      const { rows } = await client.current.query(
        `SELECT max("lastBeatAt") AS last FROM system_worker_heartbeats`,
      );
      return rows[0].last && rows[0].last.getTime() > down;
    },
    120,
  );
  check(
    "the worker recovers from a database restart unaided",
    workers.w0.exitCode === null,
    `${beat.toFixed(1)} s`,
  );
  const beforeRuns = await client.current.query(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'telephony.sweep' AND created_on > $1`,
    [new Date(down)],
  );
  await sleep(70_000);
  check("the worker is still running a minute later", workers.w0.exitCode === null);
  const afterRuns = await client.current.query(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'telephony.sweep' AND state = 'completed' AND created_on > $1`,
    [new Date(down)],
  );
  check(
    "scheduled jobs keep running after it",
    afterRuns.rows[0].n > 0,
    `${beforeRuns.rows[0].n} created, ${afterRuns.rows[0].n} finished`,
  );

  // --- Restarting an app (P11-OBS-03).
  apps[PORTS[0]].kill("SIGTERM");
  await sleep(1500);
  const other = await fetch(`${base(PORTS[1])}/api/health`);
  check("the other instance keeps answering", other.status === 200);
  apps[PORTS[0]] = startApp(PORTS[0]);
  const appBack = await until("the app", healthy(PORTS[0]));
  const signedIn = await json(PORTS[0], "/api/auth/me");
  check(
    "a restarted app comes back, and people stay signed in",
    signedIn.status === 200,
    `${appBack.toFixed(1)} s`,
  );

  // --- The real alert, raised by a running app's own timer (P11-OBS-01).
  workers.w0.kill("SIGKILL");
  await client.current.query(
    `UPDATE system_worker_heartbeats SET "lastBeatAt" = now() - interval '10 minutes'`,
  );
  const openAlert = async () => {
    const { rows } = await client.current.query(
      `SELECT count(*)::int AS n FROM monitoring_alerts WHERE code = 'worker_down' AND "resolvedAt" IS NULL`,
    );
    return rows[0].n === 1;
  };
  const raised = await until("the worker alert", openAlert, 80).catch(() => null);
  check(
    "a stopped worker raises an alert from the app",
    raised !== null,
    raised === null ? "" : `${raised.toFixed(0)} s`,
  );
  const told = await client.current.query(
    `SELECT count(*)::int AS n FROM notifications_notifications n
     JOIN monitoring_alerts a ON ('alert:' || a.id) = ANY(n."dedupeKeys")
     WHERE a.code = 'worker_down' AND a."resolvedAt" IS NULL AND n."userId" = $1`,
    [admin.id],
  );
  check("an Admin is told once", told.rows[0].n === 1, `${told.rows[0].n} notification`);
  workers = { w0: startWorker("w0") };
  const cleared = await until("the alert clearing", async () => !(await openAlert()), 80).catch(
    () => null,
  );
  check("the alert clears when the worker returns", cleared !== null);

  // --- Connection limits (P11-OBS-03).
  clearInterval(watcher);
  const { rows: limit } = await client.current.query(
    `SELECT current_setting('max_connections')::int AS n`,
  );
  const { rows: settled } = await client.current.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
  );
  check(
    "connections stayed well inside the limit",
    peak.connections < limit[0].n * 0.8,
    `peak ${peak.connections}, now ${settled[0].n}, limit ${limit[0].n}`,
  );
  await client.current.end();
} catch (error) {
  failures += 1;
  console.error("FAIL", error);
} finally {
  for (const child of children) child.kill("SIGKILL");
}
await sleep(500);
process.exit(failures > 0 ? 1 : 0);
