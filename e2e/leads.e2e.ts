// Phase 3 journeys on the built app, with real sign-ins and seeded leads.
import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next = "/leads") => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};
const newPhone = () => `98${randomInt(10000000, 99999999)}`;

test("an agent creates a lead, moves its stage, adds a note and a follow-up", async ({ page }) => {
  const phone = newPhone();
  await signIn(page, "AGENT");
  await expect(page.getByRole("heading", { name: /My leads/ })).toBeVisible();
  await page.getByRole("button", { name: "+ New lead" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Owner")).toHaveCount(0);
  await form.getByRole("button", { name: "Create lead" }).click();
  await expect(form.getByText(/Add the customer's name/)).toBeVisible();
  await form.getByLabel("Customer name").fill("रिया मेहता");
  await form.getByLabel("Phone").fill(phone);
  await form.getByLabel("Destination").fill("Kashmir");
  await form.getByLabel("Travellers").fill("4");
  await form.getByLabel("Budget (₹)").fill("1,50,000");
  await form.getByRole("button", { name: "Create lead" }).click();

  await expect(page.getByRole("heading", { name: "रिया मेहता" })).toBeVisible();
  await expect(page.getByText("₹1,50,000")).toBeVisible();

  await page.getByRole("button", { name: "Qualified" }).click();
  await expect(page.getByText("Stage changed: New → Qualified")).toBeVisible();

  await page.getByLabel("Add a note").fill("दो बच्चे <b>8 और 11</b>");
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("tab", { name: /Notes/ }).click();
  await expect(page.getByText("दो बच्चे <b>8 और 11</b>")).toBeVisible(); // shown as plain text

  await page.getByRole("tab", { name: /Follow-ups/ }).click();
  await page.getByLabel("Follow-up", { exact: true }).fill("Send houseboat photos");
  await page.getByLabel("Due date").fill("2099-01-01");
  await page.getByRole("button", { name: "Add follow-up" }).click();
  await expect(page.getByText(/Next follow-up: 1 Jan 2099/)).toBeVisible();

  await page.goto("/follow-ups?bucket=upcoming");
  await expect(page.getByText("Send houseboat photos")).toBeVisible();
});

test("Lost asks for a reason; the customer returning gets a new linked lead", async ({ page }) => {
  const phone = newPhone();
  await signIn(page, "AGENT");
  const create = async (destination: string) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "+ New lead" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Customer name").fill("Arjun Nair");
    await form.getByLabel("Phone").fill(phone);
    await form.getByLabel("Destination").fill(destination);
    await form.getByRole("button", { name: "Create lead" }).click();
  };
  await create("Kerala");
  await expect(page.getByRole("heading", { name: "Arjun Nair" })).toBeVisible();

  await create("Goa");
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Open that lead" }),
  ).toBeVisible();

  await page.getByRole("dialog").getByRole("link", { name: "Open that lead" }).click();
  await page.getByRole("button", { name: "Mark as Lost…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Move to Lost" }).click();
  await expect(dialog.getByText("Pick the main reason.").last()).toBeVisible();
  await dialog.getByLabel("Price too high").check();
  await dialog.getByRole("button", { name: "Move to Lost" }).click();
  await expect(page.getByText("Lost: Price too high")).toBeVisible();

  await create("Goa");
  await expect(page.getByText("Other trips")).toBeVisible();
  await expect(page.getByRole("link", { name: /Kerala · Lost/ })).toBeVisible();
});

test("an agent can't open someone else's lead; a manager sees the queue; filters survive Back", async ({
  page,
}) => {
  await signIn(page, "MANAGER");
  await expect(page.getByRole("heading", { name: /Team leads/ })).toBeVisible();
  await page.getByLabel("Owner").selectOption("unassigned");
  await expect(page).toHaveURL(/owner=unassigned/);
  const first = page.getByRole("link", { name: /Sample Customer/ }).first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page.getByText("Unassigned").first()).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Owner")).toHaveValue("unassigned");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, "AGENT", href!);
  await expect(page.locator("main").getByRole("alert")).toContainText("couldn't find");
});

test("search finds a phone in any format", async ({ page }) => {
  await signIn(page, "ADMIN");
  await page.getByLabel("Search name or phone").fill("90000 10003");
  await expect(page.getByRole("link", { name: "Sample Customer 4", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sample Customer 5", exact: true })).toHaveCount(0);
  await page.getByLabel("Search name or phone").fill("zzzz");
  await expect(page.getByText("No leads match these filters")).toBeVisible();
});

test("an Admin changes a setting and a wrong value is refused; a Manager can't open Settings", async ({
  page,
}) => {
  await signIn(page, "ADMIN", "/settings");
  const field = page.getByLabel("First reply target");
  await field.fill("-5");
  await field.blur();
  await expect(page.getByText("That value isn't allowed for this setting.")).toBeVisible();
  await field.fill("16");
  await field.blur();
  await expect(page.locator("main").getByRole("status")).toContainText("applies to new work");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, "MANAGER", "/settings");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
});
