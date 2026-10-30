// Critical journey 8 (Decision 29): the friendly 403, through the real guard on the built app, with
// real sign-ins.
import { expect, test } from "@playwright/test";
import { expectNoTechnicalText } from "./support/pageText";
import { seededUser, signInThroughForm } from "./support/signInUser";

test("a manager opening diagnostics sees the friendly forbidden message", async ({ page }) => {
  await page.goto("/sign-in?next=/diagnostics");
  await signInThroughForm(page, seededUser("MANAGER"));
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "You don't have access to do this.",
  );
  await expect(page.getByText(/^Reference: \S+$/)).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*/); // no permission code
  await expectNoTechnicalText(page);
});

test("an admin opening diagnostics sees the system status", async ({ page }) => {
  await page.goto("/sign-in?next=/diagnostics");
  await signInThroughForm(page, seededUser("ADMIN"));
  await expect(page.getByText("Database: up")).toBeVisible();
});

test("a signed-out visitor is asked to sign in", async ({ page }) => {
  await page.goto("/diagnostics");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Please sign in to continue.",
  );
  await expectNoTechnicalText(page);
});
