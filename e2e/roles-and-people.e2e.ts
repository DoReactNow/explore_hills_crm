// Critical journey 7 and the Phase 2 screens, with real sign-ins on the built app.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next = "/") => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};
const signOut = async (page: Page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
};

test("journey 7: a Super Admin edits a role and it applies on the next request", async ({
  page,
}) => {
  // The Manager starts with Teams.
  await signIn(page, "MANAGER");
  await expect(page.getByRole("link", { name: "Teams" })).toBeVisible();
  await signOut(page);

  await signIn(page, "SUPER_ADMIN", "/roles");
  await page.getByRole("button", { name: /^Manager/ }).click();
  await page.getByRole("switch", { name: "View teams" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("Saved");
  await signOut(page);

  await signIn(page, "MANAGER", "/teams");
  await expect(page.getByRole("link", { name: "Teams" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
  await signOut(page);

  await signIn(page, "SUPER_ADMIN", "/roles");
  await page.getByRole("button", { name: /^Manager/ }).click();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("back to its defaults");
  await expect(page.getByRole("switch", { name: "View teams" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await signOut(page);
});

test("an Admin is refused the Roles page, and sees no link to it (P2-ROLES-01)", async ({
  page,
}) => {
  await signIn(page, "ADMIN", "/roles");
  await expect(page.getByRole("link", { name: "Roles & Permissions" })).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
});

test("permission codes appear only on the Roles page (P2-ROLES-15)", async ({ page }) => {
  await signIn(page, "SUPER_ADMIN", "/roles");
  await page.getByRole("button", { name: /^Agent/ }).click();
  await expect(page.getByText("users:view", { exact: true })).toBeVisible();
  await page.goto("/employees");
  await expect(page.getByRole("heading", { name: /Employees/ })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/users:view/);
});

test("an Admin adds an employee, opens the record and sets a new password", async ({ page }) => {
  const email = `${randomUUID()}@example.com`;
  await signIn(page, "ADMIN", "/employees");
  await page.getByRole("button", { name: "+ Add employee" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Full name").fill("Rahul Joshi");
  await add.getByLabel("Work email").fill(email);
  await add.getByLabel("Default password").fill("weak");
  await add.getByRole("button", { name: "Add employee" }).click();
  await expect(add.getByText(/at least 12 characters/i).first()).toBeVisible();
  await add.getByLabel("Default password").fill("Correct-Horse-Battery-9");
  await add.getByLabel("Role").selectOption({ label: "Agent" });
  await add.getByRole("button", { name: "Add employee" }).click();

  await expect(page.getByRole("heading", { name: "Rahul Joshi" })).toBeVisible();

  await page.getByRole("button", { name: "Set password" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("signed out of all devices");
  await dialog.getByLabel("New password").fill("Winding-Valley-Road-77");
  await dialog.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("signed out everywhere");
  expect(await page.locator("body").innerText()).not.toContain("Winding-Valley-Road-77");
  await signOut(page);

  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Winding-Valley-Road-77");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("filters live in the URL, so Back returns to the same view", async ({ page }) => {
  await signIn(page, "ADMIN", "/employees");
  await page.getByLabel("Status").selectOption("DEACTIVATED");
  await expect(page).toHaveURL(/status=DEACTIVATED/);
  await expect(page.getByRole("link", { name: /Former Colleague/ })).toBeVisible();
  await page.getByRole("link", { name: /Former Colleague/ }).click();
  await expect(page.getByRole("heading", { name: "Former Colleague" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/status=DEACTIVATED/);
  await expect(page.getByLabel("Status")).toHaveValue("DEACTIVATED");
});

test("an Admin gets no controls on a Super Admin's record (P2-UMGMT-01, -06)", async ({ page }) => {
  await signIn(page, "ADMIN", "/employees?search=Ira");
  await page.getByRole("link", { name: /Ira Sample/ }).click();
  await expect(page.getByText("Only another Super Admin can change this account.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Set password" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("a Manager and an Agent cannot open the employee page (P2-UMGMT-06)", async ({ page }) => {
  await signIn(page, "MANAGER", "/employees");
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
  await expect(page.getByRole("link", { name: "Employees" })).toHaveCount(0);
  await signOut(page);
  await signIn(page, "AGENT", "/employees");
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
});

test("a Manager sees their team read-only; an Admin can create and delete one", async ({
  page,
}) => {
  await signIn(page, "MANAGER", "/teams");
  await expect(page.getByRole("button", { name: /Sales North/ })).toBeVisible();
  await expect(page.getByText("Ravi Sample")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ New team" })).toHaveCount(0);
  await signOut(page);

  const name = `Team ${randomUUID().slice(0, 8)}`;
  await signIn(page, "ADMIN", "/teams");
  await page.getByRole("button", { name: "+ New team" }).click();
  await page.getByRole("dialog").getByLabel("Team name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create team" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete team" }).click();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);

  // A team with members explains why it can't go.
  await page.getByRole("button", { name: /Sales North/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete team" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Move this team's members",
  );
});
