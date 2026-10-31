// Phase 6: the agent's workspace on the built app, with live updates between real sessions.
import { expect, test, type Page } from "@playwright/test";
import { customerSends } from "./support/whatsapp";
import { clearSignInLimit, seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next: string) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};
const owned = "Owned Customer New";

test("quick filters match their counts (P6-WORK-01)", async ({ page }) => {
  await signIn(page, "AGENT", "/leads");
  const open = page.getByRole("button", { name: /^Open · \d+/ });
  await expect(open).toBeVisible();
  const count = Number((await open.innerText()).split("·")[1]);
  await open.click();
  await expect(page).toHaveURL(/quick=open/);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBe(Math.min(count, 50));
});

test("J, K and Enter open a lead, but not while typing (P6-WORK-07)", async ({ page }) => {
  await signIn(page, "AGENT", "/leads");
  await page.locator("tbody tr").first().waitFor();
  await page.getByLabel("Search name or phone").focus();
  await page.keyboard.press("j");
  await expect(page.locator('tbody tr[aria-selected="true"]')).toHaveCount(0);
  await page.getByLabel("Search name or phone").fill("");
  await page.locator("h1").click();
  await page.keyboard.press("j");
  await expect(page.locator('tbody tr[aria-selected="true"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
});

test("a second tab stays up to date without losing what is typed (P6-WORK-03, -05)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first, "AGENT", "/leads");
  await first.getByRole("link", { name: owned, exact: true }).click();
  await first.getByRole("heading", { name: owned }).waitFor();
  const second = await context.newPage();
  await second.goto(first.url());
  await second.getByLabel("Add a note").fill("Half-written thought");

  const note = `Called back ${first.url().slice(-6)} ${performance.now()}`;
  await first.getByLabel("Add a note").fill(note);
  await first.getByRole("button", { name: "Add note" }).click();
  await expect(
    second.getByRole("region", { name: "Activity" }).getByText("Note added").first(),
  ).toBeVisible();
  await expect(second.getByLabel("Add a note")).toHaveValue("Half-written thought");
});

test("the lead's chat works on its page, and a new message arrives live (P6-WORK-03)", async ({
  page,
  baseURL,
}) => {
  const phone = `9198${String((Math.floor(performance.now() * 1000) % 90000000) + 10000000)}`;
  await customerSends(baseURL as string, phone, "Hello from Goa", "Goa Customer");
  await signIn(page, "ADMIN", `/leads?search=${phone}`);
  await page.getByRole("link", { name: "Goa Customer" }).click();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat.getByText("Hello from Goa")).toBeVisible();
  await chat.getByRole("textbox").first().fill("Half a reply");
  await customerSends(baseURL as string, phone, "One more thing", "Goa Customer");
  await expect(chat.getByText("One more thing")).toBeVisible();
  await expect(chat.getByRole("textbox").first()).toHaveValue("Half a reply");
});

test("a lead reassigned away shows a notice and stops edits, keeping the text (P6-WORK-02)", async ({
  browser,
}) => {
  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, "MANAGER", "/queue");
  await manager.getByRole("checkbox", { name: "Select Sample Customer 16" }).check();
  await manager.getByRole("button", { name: "Assign 1 lead" }).click();
  const panel = manager.getByRole("dialog", { name: "Assign leads" });
  await panel.getByRole("radio", { name: /One agent/ }).check();
  await panel.getByRole("button", { name: "Next: choose agents" }).click();
  await panel.getByRole("radio", { name: new RegExp(seededUser("AGENT").name) }).check();
  await panel.getByRole("button", { name: "Preview" }).click();
  await panel.getByRole("button", { name: "Assign 1 lead" }).click();
  await panel.getByRole("status").waitFor();

  const agent = await (await browser.newContext()).newPage();
  await signIn(agent, "AGENT", "/leads?search=Sample%20Customer%2016");
  await agent.getByRole("link", { name: "Sample Customer 16" }).click();
  await agent.getByLabel("Add a note").fill("Do not lose me");

  await manager.goto("/leads?search=Sample%20Customer%2016");
  await manager.getByRole("link", { name: "Sample Customer 16" }).click();
  await manager.getByRole("button", { name: "Reassign…" }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByLabel("New owner").selectOption({ index: 1 });
  await dialog.getByLabel("Reason").fill("Rebalancing");
  await dialog.getByRole("button", { name: "Reassign" }).click();

  await expect(agent.getByText("no longer yours")).toBeVisible();
  await expect(agent.getByLabel("Add a note")).toHaveValue("Do not lose me");
  await expect(agent.getByRole("button", { name: "Add note" })).toBeDisabled();
});

test("a phone gets the tab bar and the More sheet", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await clearSignInLimit();
  await page.goto("/sign-in?next=/leads");
  await page.getByLabel("Work email").fill(seededUser("AGENT").email);
  await page.getByLabel("Password", { exact: true }).fill(seededUser("AGENT").password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const tabs = page.getByRole("navigation", { name: "Phone" });
  await expect(tabs.getByRole("link", { name: "Blast pool" })).toBeVisible();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(
    page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }),
  ).toBeVisible();
});
