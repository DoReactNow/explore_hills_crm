// Phase 9: dashboards and reports through the real screens.
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next: string) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};

test("each role gets its own dashboard (P9-REPORT-01)", async ({ browser }) => {
  for (const [role, word] of [
    ["AGENT", "Your numbers"],
    ["MANAGER", "Team pulse"],
    ["ADMIN", "Company overview"],
  ] as const) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, role, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(word);
    await expect(page.getByText("Open leads")).toBeVisible();
    await page.getByRole("button", { name: "7 days" }).click();
    await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("a manager reads each report tab, and a reversed range is refused kindly", async ({
  page,
}) => {
  await signIn(page, "MANAGER", "/reports");
  await expect(page.getByRole("heading", { name: "Leads per day" })).toBeVisible();
  for (const [tab, heading] of [
    ["Assignment", "How leads were assigned"],
    ["Response time", "First reply time"],
    ["Conversion", "Conversion funnel"],
    ["Agents", "Per agent"],
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await page.getByLabel("From").fill("2026-12-31");
  await page.getByLabel("To").fill("2026-01-01");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
});

test("an export downloads as a spreadsheet file (P9-EXPORT-01, -05)", async ({ page }) => {
  await signIn(page, "MANAGER", "/reports?tab=agents");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export this tab" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^agents-.*\.csv$/);
});

test("an agent has no reports (P9-REPORT-01)", async ({ page }) => {
  await signIn(page, "AGENT", "/reports");
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
});
