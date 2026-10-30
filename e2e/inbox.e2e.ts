// Critical journey 4: a customer's WhatsApp message becomes a lead and a chat, an agent replies, and
// the screen updates live. Uses the fake gateway and a real worker.
import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";
import { customerSends } from "./support/whatsapp";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next = "/inbox") => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};
const newNumber = () => `9198${randomInt(10000000, 99999999)}`;

test("a message makes a lead and a chat live; a reply is sent; the stage moves", async ({
  page,
  baseURL,
}) => {
  const from = newNumber();
  await signIn(page, "ADMIN");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  await customerSends(baseURL!, from, "दिसंबर में कश्मीर <b>4 लोग</b>", "Riya Live");
  await page.getByRole("button", { name: /Riya Live/ }).click(); // appeared with no reload

  await expect(page.getByText("दिसंबर में कश्मीर <b>4 लोग</b>")).toBeVisible();
  await expect(page.getByText(/Reply window open/)).toBeVisible();

  await page.getByLabel("Type a message").fill("Happy to help!");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Happy to help!")).toBeVisible();
  await expect(page.getByText(/Sent/).first()).toBeVisible();

  await customerSends(baseURL!, from, "Thank you!");
  await expect(page.getByRole("region", { name: "Chat" }).getByText("Thank you!")).toBeVisible();

  await page.getByRole("link", { name: "Open lead" }).click();
  await expect(page.getByRole("heading", { name: "Riya Live" })).toBeVisible();
  await expect(page.getByText("Stage changed: New → Contacted")).toBeVisible();

  // And back: the lead page opens the same chat.
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect(
    page.getByRole("region", { name: "Chat" }).getByText("Happy to help!"),
  ).toBeVisible();
});

test("after the window, only a template can be sent; variables are required", async ({
  page,
  baseURL,
}) => {
  const from = newNumber();
  await customerSends(baseURL!, from, "Old message", "Harpreet Old", 30);
  await signIn(page, "ADMIN");
  await page.getByRole("button", { name: /Harpreet Old/ }).click();
  await expect(
    page.getByText("The 24-hour reply window has closed. Send an approved template."),
  ).toBeVisible();
  await expect(page.getByLabel("Type a message")).toHaveCount(0);

  await page.getByRole("button", { name: "Choose a template" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /Festive offer/ })).toHaveCount(0); // not approved
  await dialog.getByRole("button", { name: /Trip reminder/ }).click();
  await dialog.getByLabel("Detail 2").fill("");
  await dialog.getByRole("button", { name: "Send template" }).click();
  await expect(dialog.getByText("Please fill in every detail before sending.")).toBeVisible();
  await dialog.getByLabel("Detail 2").fill("Andaman");
  await dialog.getByRole("button", { name: "Send template" }).click();
  await expect(page.getByText(/your Andaman trip is coming up/)).toBeVisible();
});

test("STOP blocks sending, with a clear reason", async ({ page, baseURL }) => {
  const from = newNumber();
  await customerSends(baseURL!, from, "Hello", "Stop Person");
  await signIn(page, "ADMIN");
  await page.getByRole("button", { name: /Stop Person/ }).click();
  await customerSends(baseURL!, from, "STOP");
  await expect(page.getByText(/has opted out/)).toBeVisible();
  await expect(page.getByLabel("Type a message")).toHaveCount(0);
});

test("an agent's inbox shows only their own chats", async ({ page, baseURL }) => {
  await customerSends(baseURL!, newNumber(), "Not yours", "Someone Else");
  await signIn(page, "AGENT");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Someone Else/ })).toHaveCount(0);
});

test("an Admin manages templates; a Manager can't open the page", async ({ page }) => {
  const name = `Welcome ${randomInt(1000, 9999)}`;
  await signIn(page, "ADMIN", "/templates");
  await expect(page.getByText("Marketing messages need a way to opt out.")).toBeVisible();
  await page.getByRole("button", { name: "+ New template" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Message").fill("Hi {{2}}");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(dialog.getByText(/Number the details in order/)).toBeVisible();
  await dialog.getByLabel("Message").fill("Hi {{1}}, welcome!");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, "MANAGER", "/templates");
  await expect(page.locator("main").getByRole("alert")).toContainText("You don't have access");
});
