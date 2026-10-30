// Phase 5: a manager shares out the queue, an agent accepts from the blast pool, and a lead is
// reassigned, all through the real screens.
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const AGENT = seededUser("AGENT").name;
const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next: string) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};

test("a manager previews and assigns a lead, and it leaves the queue (P5-QUEUE-02, -07)", async ({
  page,
}) => {
  await signIn(page, "MANAGER", "/queue");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("enquiries");
  await page.getByRole("checkbox", { name: "Select Sample Customer 19" }).check();
  await page.getByRole("button", { name: "Assign 1 lead" }).click();

  const panel = page.getByRole("dialog", { name: "Assign leads" });
  await panel.getByRole("radio", { name: /One agent/ }).check();
  await panel.getByRole("button", { name: "Next: choose agents" }).click();
  await panel.getByRole("radio", { name: new RegExp(AGENT) }).check();
  await panel.getByRole("button", { name: "Preview" }).click();
  await expect(panel.getByText("Sample Customer 19")).toBeVisible();
  await panel.getByRole("button", { name: "Assign 1 lead" }).click();
  await expect(panel.getByRole("status")).toContainText("1 assigned");
  await expect(panel.getByRole("button", { name: /Undo/ })).toBeVisible();
  await panel.getByRole("button", { name: "Back to queue" }).click();
  await expect(page.getByRole("checkbox", { name: "Select Sample Customer 19" })).toHaveCount(0);
});

test("an agent accepts a blasted lead, which disappears for the manager's selection (P5-BLAST-11)", async ({
  browser,
}) => {
  const managerPage = await (await browser.newContext()).newPage();
  await signIn(managerPage, "MANAGER", "/queue");
  await managerPage.getByRole("checkbox", { name: "Select Sample Customer 18" }).check();
  await managerPage.getByRole("button", { name: "Assign 1 lead" }).click();
  const panel = managerPage.getByRole("dialog", { name: "Assign leads" });
  await panel.getByRole("radio", { name: /Blast/ }).check();
  await panel.getByRole("button", { name: "Next: choose agents" }).click();
  await panel.getByRole("button", { name: "Preview" }).click();
  await panel.getByRole("button", { name: "Offer 1 lead" }).click();
  await expect(panel.getByRole("status")).toContainText("1 offered");
  await panel.getByRole("button", { name: "Back to queue" }).click();
  await expect(managerPage.getByText("In blast")).toBeVisible();

  const agentPage = await (await browser.newContext()).newPage();
  await signIn(agentPage, "AGENT", "/blast");
  const card = agentPage.getByRole("article").filter({ hasText: "Sample Customer 18" });
  await card.getByRole("button", { name: "Accept lead" }).click();
  await expect(agentPage).toHaveURL(/\/leads\//);
  await expect(agentPage.getByRole("heading", { level: 1 })).toHaveText("Sample Customer 18");
  await expect(
    managerPage.getByRole("checkbox", { name: "Select Sample Customer 18" }),
  ).toHaveCount(0);
});

test("a manager reassigns a lead, with a reason (P5-REASSIGN-01, -04)", async ({ page }) => {
  await signIn(page, "MANAGER", "/leads?search=Sample%20Customer%2019");
  await page.getByRole("link", { name: "Sample Customer 19" }).click();
  await page.getByRole("button", { name: "Reassign…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New owner").selectOption({ index: 1 });
  await expect(dialog.getByRole("button", { name: "Reassign" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Speaks the customer's language");
  await dialog.getByRole("button", { name: "Reassign" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Assigned to .* Chosen by hand/).first()).toBeVisible();
});

test("an agent can't open the queue or the rules, and a manager can't open the pool", async ({
  browser,
}) => {
  const agentPage = await (await browser.newContext()).newPage();
  await signIn(agentPage, "AGENT", "/queue");
  await expect(agentPage.locator("main").getByRole("alert")).toContainText("You don't have access");
  await agentPage.goto("/assignment-rules");
  await expect(agentPage.locator("main").getByRole("alert")).toContainText("You don't have access");

  const managerPage = await (await browser.newContext()).newPage();
  await signIn(managerPage, "MANAGER", "/blast");
  await expect(managerPage.locator("main").getByRole("alert")).toContainText(
    "You don't have access",
  );
});
