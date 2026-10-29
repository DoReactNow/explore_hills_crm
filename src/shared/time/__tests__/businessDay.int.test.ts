// W-006: "today" and daily buckets around business midnight, against the real test database.
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { businessDayRange, parseBusinessLocalDateTime } from "..";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
afterAll(async () => {
  await resetDatabase();
  await client.end();
});
beforeEach(() => resetDatabase());

async function insertBeat(workerId: string, at: Date) {
  await client.query(
    `INSERT INTO system_worker_heartbeats ("workerId", version, "startedAt", "lastBeatAt") VALUES ($1, 't', $2, $2)`,
    [workerId, at],
  );
}

describe("business day queries", () => {
  it("runs Postgres in UTC", async () => {
    const { rows } = await client.query("SHOW timezone");
    expect(rows[0].TimeZone).toBe("UTC");
  });

  it("returns 23:59 and 00:01 records on the correct 'today' across a month boundary", async () => {
    await insertBeat("late", parseBusinessLocalDateTime("2027-01-31", "23:59"));
    await insertBeat("early", parseBusinessLocalDateTime("2027-02-01", "00:01"));

    const today = async (day: string) => {
      const { start, end } = businessDayRange(day);
      const { rows } = await client.query<{ workerId: string }>(
        `SELECT "workerId" FROM system_worker_heartbeats WHERE "lastBeatAt" >= $1 AND "lastBeatAt" < $2`,
        [start, end],
      );
      return rows.map((row) => row.workerId);
    };

    expect(await today("2027-01-31")).toEqual(["late"]);
    expect(await today("2027-02-01")).toEqual(["early"]);
  });

  it("groups them into different daily buckets with AT TIME ZONE <business tz>", async () => {
    await insertBeat("late", parseBusinessLocalDateTime("2027-01-31", "23:59"));
    await insertBeat("early", parseBusinessLocalDateTime("2027-02-01", "00:01"));

    const { rows } = await client.query<{ day: string; n: string }>(
      `SELECT to_char(("lastBeatAt" AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, count(*) AS n
       FROM system_worker_heartbeats GROUP BY 1 ORDER BY 1`,
      [APP_CONFIG.locale.businessTimezone],
    );
    expect(rows).toEqual([
      { day: "2027-01-31", n: "1" },
      { day: "2027-02-01", n: "1" },
    ]);
  });
});
