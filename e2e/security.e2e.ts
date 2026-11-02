// Phase 11: security headers on the built app, and scripts stored in customer data never running.
import { expect, test, type Page } from "@playwright/test";
import { plantCustomer, removePlanted } from "./support/plantCustomer";
import { seededUser, signInThroughForm } from "./support/signInUser";

test("pages and API answers carry the security headers (P11-SEC-02)", async ({ request }) => {
  const page = await request.get("/sign-in");
  const pageHeaders = page.headers();
  expect(pageHeaders["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(pageHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(pageHeaders["x-content-type-options"]).toBe("nosniff");
  expect(pageHeaders["x-frame-options"]).toBe("DENY");
  expect(pageHeaders["strict-transport-security"]).toContain("max-age=");
  expect(pageHeaders["permissions-policy"]).toContain("microphone=(self)");
  expect(pageHeaders["x-powered-by"]).toBeUndefined();

  const api = await request.get("/api/health");
  expect(api.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");

  const again = await request.get("/sign-in");
  expect(again.headers()["content-security-policy"]).not.toBe(
    pageHeaders["content-security-policy"],
  );
});

test("the page's own scripts run, and an injected one doesn't (P11-SEC-02)", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();
  const blocked = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener("securitypolicyviolation", (event) =>
          resolve(event.effectiveDirective),
        );
        document.body.insertAdjacentHTML(
          "beforeend",
          `<img src="/favicon.ico" onload="window.__injected = true">`,
        );
      }),
  );
  expect(await blocked).toContain("script-src");
  expect(await page.evaluate(() => "__injected" in window)).toBe(false);
});

const PAYLOAD = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;

async function expectNothingRan(page: Page, path: string, violations: string[]) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(await page.evaluate(() => "__xss" in window), path).toBe(false);
  expect(violations, path).toEqual([]);
}

test("scripts stored in customer data never run on any screen (P11-SEC-03)", async ({ page }) => {
  test.setTimeout(120_000);
  const user = seededUser("SUPER_ADMIN");
  const leadId = await plantCustomer(user.email, PAYLOAD);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`csp-violation ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (message.text().includes("csp-violation")) violations.push(message.text());
  });

  await page.goto("/sign-in");
  await signInThroughForm(page, user);
  for (const path of [
    "/leads",
    `/leads/${leadId}`,
    "/inbox",
    "/follow-ups",
    "/notifications",
    "/queue",
    "/calls",
    "/reports",
    "/privacy",
    "/audit",
  ]) {
    await expectNothingRan(page, path, violations);
  }
  expect(dialogs).toEqual([]);
  await expect(async () => {
    await page.goto(`/leads/${leadId}`);
    await expect(page.getByText("onerror", { exact: false }).first()).toBeVisible();
  }).toPass();
  await removePlanted([leadId]);
});
