// P11-OBS-02: a timed backup and restore, for the database and recordings. Works on the throwaway load
// database and invented files, then compares every table's row count and every file's checksum.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const FILES = 500;
const hostUrl = (name) =>
  `postgresql://explorehills_user:explorehills_password@127.0.0.1:54329/${name}`;
const containerUrl = (name) =>
  `postgresql://explorehills_user:explorehills_password@127.0.0.1:5432/${name}`;
const PG_TOOLS = "docker exec -i explorehills_local_db";
const sh = (command, args, env = {}) =>
  execFileSync(command, args, {
    stdio: "pipe",
    env: { ...process.env, ...env, PG_TOOLS },
  }).toString();
const seconds = (from) => ((performance.now() - from) / 1000).toFixed(1);
const admin = (sql) =>
  sh("docker", [
    "exec",
    "explorehills_local_db",
    "psql",
    "-q",
    "-U",
    "explorehills_user",
    "-d",
    "postgres",
    "-c",
    sql,
  ]);

const work = mkdtempSync(join(tmpdir(), "explorehills-restore-"));
const storage = join(work, "storage");
const restored = join(work, "restored");
const backup = join(work, "backup");
let failures = 0;
const check = (name, good, detail = "") => {
  if (!good) failures += 1;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

async function counts(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const tables = await client.query(
    `SELECT schemaname || '.' || tablename AS name FROM pg_tables
     WHERE schemaname IN ('public', 'pgboss') ORDER BY 1`,
  );
  const result = {};
  for (const { name } of tables.rows) {
    const [schema, table] = name.split(".");
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
    result[name] = rows[0].n;
  }
  await client.end();
  return result;
}

try {
  // Recordings: real files on disk, with their checksums in the database as the app stores them.
  const source = new pg.Client({ connectionString: hostUrl("explorehills_load") });
  await source.connect();
  const calls = await source.query(`SELECT id FROM telephony_calls LIMIT ${FILES}`);
  await source.query(`DELETE FROM telephony_recordings`);
  for (const { id } of calls.rows) {
    const bytes = randomBytes(256 * 1024);
    const key = `recordings/2026/11/${id}.mp3`;
    mkdirSync(join(storage, "recordings/2026/11"), { recursive: true });
    writeFileSync(join(storage, key), bytes);
    await source.query(
      `INSERT INTO telephony_recordings
         (id, "callId", status, "storageKey", "contentType", "sizeBytes", "checksumSha256", "updatedAt")
       VALUES ($1, $2, 'STORED', $3, 'audio/mpeg', $4, $5, now())`,
      [randomUUID(), id, key, bytes.length, createHash("sha256").update(bytes).digest("hex")],
    );
  }
  await source.end();
  const before = await counts(hostUrl("explorehills_load"));

  let started = performance.now();
  sh("scripts/ops/backup.sh", [backup, storage], {
    BACKUP_DATABASE_URL: containerUrl("explorehills_load"),
  });
  const backupSeconds = seconds(started);

  admin("DROP DATABASE IF EXISTS explorehills_restore WITH (FORCE)");
  admin("CREATE DATABASE explorehills_restore");
  started = performance.now();
  sh("scripts/ops/restore.sh", [backup, restored], {
    RESTORE_DATABASE_URL: containerUrl("explorehills_restore"),
  });
  const restoreSeconds = seconds(started);

  const after = await counts(hostUrl("explorehills_restore"));
  const different = Object.keys(before).filter((name) => before[name] !== after[name]);
  check(
    `all ${Object.keys(before).length} tables came back with the same rows`,
    different.length === 0,
    different.join(", "),
  );
  check(
    "the messages are all there",
    after["public.messaging_messages"] === before["public.messaging_messages"],
    `${after["public.messaging_messages"]} rows`,
  );

  const target = new pg.Client({ connectionString: hostUrl("explorehills_restore") });
  await target.connect();
  const rows = await target.query(
    `SELECT "storageKey", "checksumSha256" FROM telephony_recordings`,
  );
  const bad = rows.rows.filter(
    (row) =>
      createHash("sha256")
        .update(readFileSync(join(restored, row.storageKey)))
        .digest("hex") !== row.checksumSha256,
  );
  check(
    `all ${rows.rows.length} recordings match their stored checksum`,
    rows.rows.length === FILES && bad.length === 0,
  );
  const trigger = await target.query(
    `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname NOT LIKE 'RI_%' AND NOT tgisinternal`,
  );
  check(
    "append-only protections came back",
    trigger.rows[0].n > 0,
    `${trigger.rows[0].n} triggers`,
  );
  await target.end();

  // The safety rails.
  let refused = false;
  try {
    sh("scripts/ops/restore.sh", [backup], {
      RESTORE_DATABASE_URL: containerUrl("explorehills_restore"),
    });
  } catch {
    refused = true;
  }
  check("a restore over existing data is refused", refused);
  writeFileSync(join(backup, "files.tar.gz"), "damaged");
  refused = false;
  admin("DROP DATABASE IF EXISTS explorehills_restore WITH (FORCE)");
  admin("CREATE DATABASE explorehills_restore");
  try {
    sh("scripts/ops/restore.sh", [backup, join(work, "other")], {
      RESTORE_DATABASE_URL: containerUrl("explorehills_restore"),
    });
  } catch {
    refused = true;
  }
  check("a damaged backup is refused", refused);

  console.log(`backup ${backupSeconds} s, restore ${restoreSeconds} s, ${FILES} files`);
} finally {
  admin("DROP DATABASE IF EXISTS explorehills_restore WITH (FORCE)");
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures > 0 ? 1 : 0);
