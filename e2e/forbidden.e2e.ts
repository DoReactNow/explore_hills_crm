// Critical journey 8 (Decision 29): the friendly 403, through the real guard on the built app.
// The test-only eh_test_role cookie makes the server act as a role (APP_ENV=test only).
import { expect, test, type BrowserContext } from "@playwright/test";
import { expectNoTechnicalText } from "./support/pageText";

async function actAs(context: BrowserContext, baseURL: string | undefined, role: string) {
  await context.addCookies([{ name: "eh_test_role", value: role, url: baseURL! }]);
}

test("a manager opening diagnostics sees the friendly forbidden message", async ({
  page,
  context,
  baseURL,
}) => {
  await actAs(context, baseURL, "MANAGER");
  await page.goto("/diagnostics");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "You don't have access to do this.",
  );
  await expect(page.getByText(/^Reference: \S+$/)).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*/); // no permission code
  await expectNoTechnicalText(page);
});

test("an admin opening diagnostics sees the system status", async ({ page, context, baseURL }) => {
  await actAs(context, baseURL, "ADMIN");
  await page.goto("/diagnostics");
  await expect(page.getByText("Database: up")).toBeVisible();
});

test("a signed-out visitor is asked to sign in", async ({ page }) => {
  await page.goto("/diagnostics");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Please sign in to continue.",
  );
  await expectNoTechnicalText(page);
});
