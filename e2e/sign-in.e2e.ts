// The sign-in page and shell in a real browser, with a real session.
import { expect, test, type Page } from "@playwright/test";
import { seededUser } from "./support/signInUser";

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a person signs in, returns to the page they wanted, and sees who they are (P1-SIGNIN-11)", async ({
  page,
}) => {
  const { email, name, password } = seededUser("ADMIN");
  await page.goto("/diagnostics");
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdiagnostics/);
  await fillAndSubmit(page, email, password);
  await expect(page).toHaveURL(/\/diagnostics$/);
  await expect(page.getByText("Database: up")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByRole("link", { name: "Diagnostics" })).toBeVisible();
});

test("a return address pointing to another website is ignored (P1-SIGNIN-11)", async ({ page }) => {
  const { email, password } = seededUser("AGENT");
  await page.goto("/sign-in?next=https://evil.example/");
  await fillAndSubmit(page, email, password);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("a wrong password shows the friendly message and keeps the email", async ({ page }) => {
  const { email } = seededUser("AGENT");
  await page.goto("/sign-in");
  await fillAndSubmit(page, email, "Wrong-Horse-Battery-9");
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "That email and password don't match.",
  );
  await expect(page.getByLabel("Work email")).toHaveValue(email);
});

test("after sign-out, Back shows no protected data (P1-SESSION-11)", async ({ page }) => {
  const { email, password } = seededUser("ADMIN");
  await page.goto("/sign-in?next=/diagnostics");
  await fillAndSubmit(page, email, password);
  await expect(page.getByText("Database: up")).toBeVisible();

  // Leave a protected page in the history behind the one we sign out from.
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/diagnostics$/);
  await expect(page.locator("main").getByRole("alert")).toContainText("Please sign in");
  await expect(page.getByText("Database: up")).toHaveCount(0);
});

test("an agent is not offered diagnostics, and a narrow screen still works", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { email, name, password } = seededUser("AGENT");
  await page.goto("/sign-in");
  await fillAndSubmit(page, email, password);
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByRole("link", { name: "Diagnostics" })).toHaveCount(0);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);
});
