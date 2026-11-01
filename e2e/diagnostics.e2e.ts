// Phase 11: the Diagnostics screen shows an open alert, tracked errors and how much room is left.
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { seededUser, signInThroughForm } from "./support/signInUser";

test("an Admin sees alerts, errors and capacity (P11-OBS-01)", async ({ page }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DELETE FROM monitoring_alerts`);
  await client.query(`DELETE FROM monitoring_errors`);
  await client.query(
    `INSERT INTO monitoring_alerts (id, code, detail, "openedAt", "lastSeenAt")
     VALUES (gen_random_uuid(), 'disk_low', '1.5 GB free of 40.0 GB.', now(), now())`,
  );
  await client.query(
    `INSERT INTO monitoring_errors
       (id, fingerprint, "hourStart", name, message, source, count, "lastSeenAt")
     VALUES (gen_random_uuid(), 'f1', date_trunc('hour', now()), 'TypeError',
             'request failed: could not read a lead', 'worker', 7, now())`,
  );
  await client.end();

  await page.goto("/sign-in?next=/diagnostics");
  await signInThroughForm(page, seededUser("ADMIN"));
  await expect(page.getByText("Database: up")).toBeVisible();
  await expect(page.getByText("The server is running out of disk space")).toBeVisible();
  await expect(page.getByText("1.5 GB free of 40.0 GB.")).toBeVisible();
  const row = page.getByRole("row", { name: /could not read a lead/ });
  await expect(row.getByRole("cell", { name: "Worker" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "7", exact: true })).toBeVisible();
  await expect(page.getByText("Database connections")).toBeVisible();

  const client2 = new Client({ connectionString: process.env.DATABASE_URL });
  await client2.connect();
  await client2.query(`DELETE FROM monitoring_alerts`);
  await client2.query(`DELETE FROM monitoring_errors`);
  await client2.end();
});
