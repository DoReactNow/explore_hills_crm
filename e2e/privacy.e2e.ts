// Phase 10: the audit trail, a customer's privacy record and the public notice through the real screens.
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next: string) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};

/** A new customer on a closed lead, made through the API as the signed-in person. */
async function closedLead(page: Page) {
  const phone = `+9198${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const name = `Privacy ${phone.slice(-6)}`;
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/leads", {
    headers,
    data: { customerName: name, phone: phone.slice(3) },
  });
  expect(created.ok()).toBe(true);
  const { data: lead } = (await created.json()) as {
    data: { id: string; contact: { id: string } };
  };
  const closed = await page.request.post(`/api/leads/${lead.id}/stage`, {
    headers,
    data: { stageCode: "LOST", lostReason: "Price" },
  });
  expect(closed.ok()).toBe(true);
  return { phone, name, leadId: lead.id, contactId: lead.contact.id };
}

test("the privacy notice is public and uses the company's details (P10-ERASE-12)", async ({
  page,
}) => {
  await page.goto("/privacy-notice");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy notice");
  await expect(page.getByText("Draft wording")).toBeVisible();
  await expect(page.getByText("support@example.com")).toBeVisible();
  await expect(page.getByText("730 days")).toBeVisible();
  await expect(page.getByText("{company}")).toHaveCount(0);
});

test("an Admin reads and filters the audit trail, with nothing to edit (P10-AUDV-02, -03)", async ({
  page,
}) => {
  await signIn(page, "ADMIN", "/audit");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audit trail");
  await expect(page.getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
  await page.getByLabel("What").selectOption("auth.signed_in");
  await expect(page).toHaveURL(/action=auth\.signed_in/);
  await expect(page.getByRole("cell", { name: "Signed in" }).first()).toBeVisible();
  await page.getByLabel("From").fill("2020-01-01");
  await page.getByLabel("To").fill("2020-01-02");
  await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
});

test("an Agent can't open the audit trail or privacy pages (P10-AUDV-01)", async ({ page }) => {
  await signIn(page, "AGENT", "/audit");
  await expect(page.getByRole("heading", { name: "Audit trail" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit trail" })).toHaveCount(0);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Customer privacy" })).toHaveCount(0);
});

test("an Admin finds a customer, records consent, and erases them (P10-ERASE-01, -03, -08)", async ({
  page,
}) => {
  await signIn(page, "ADMIN", "/privacy");
  const customer = await closedLead(page);

  await page.getByLabel("Name, number or email").fill(customer.name);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: new RegExp(customer.name) }).click();
  await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();

  await page.getByRole("button", { name: "Withdraw Call recording" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Call recording: withdrawn", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("WhatsApp messages: not given yet")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download their data" }).click(),
  ]);
  expect(download.suggestedFilename()).toContain(customer.contactId);

  await page.getByRole("button", { name: "Place a hold…" }).click();
  await page.getByRole("button", { name: "Place hold" }).click();
  await expect(page.getByText("On hold")).toBeVisible();
  await expect(page.getByRole("button", { name: "Erase their data…" })).toBeDisabled();
  await page.getByRole("button", { name: "Release hold" }).click();
  await expect(page.getByText("On hold")).toHaveCount(0);

  await page.getByRole("button", { name: "Erase their data…" }).click();
  await page.getByLabel("Type the customer's number to confirm").fill("+919800000000");
  await page.getByRole("button", { name: "Erase for good" }).click();
  await expect(page.getByText("That isn't this customer's number.")).toBeVisible();
  await page.getByLabel("Type the customer's number to confirm").fill(customer.phone);
  await page.getByRole("button", { name: "Erase for good" }).click();
  await expect(page.getByRole("heading", { name: "Erased customer" })).toBeVisible();
  await expect(page.getByText(customer.phone)).toHaveCount(0);

  await page.goto(`/leads/${customer.leadId}`);
  await expect(page.getByText("This customer's data was erased.")).toBeVisible();
  await expect(page.getByText(customer.name)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open chat" })).toHaveCount(0);

  await page.goto(`/audit?entityType=contact&entityId=${customer.contactId}`);
  await expect(page.getByRole("cell", { name: "Customer data erased" })).toBeVisible();
});

test("the audit trail and privacy pages fit a phone", async ({ page }) => {
  await signIn(page, "ADMIN", "/audit");
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/audit", "/privacy"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
