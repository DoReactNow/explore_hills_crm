// The health endpoint answers on the built app (W-003).
import { expect, test } from "@playwright/test";

test("GET /api/health returns ok on the built app", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({ status: "ok", database: "up" });
});
