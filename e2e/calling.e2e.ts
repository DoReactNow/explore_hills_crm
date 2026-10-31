// Phase 7: calling on the fake provider, through the real screens, webhooks and worker.
import { expect, test, type Page } from "@playwright/test";
import { seededUser, signInThroughForm } from "./support/signInUser";

const signIn = async (page: Page, role: Parameters<typeof seededUser>[0], next: string) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await signInThroughForm(page, seededUser(role));
};
const openLead = async (page: Page, name: string) => {
  await page.goto(`/leads?search=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("heading", { name }).waitFor();
};
const panel = (page: Page) => page.getByRole("region", { name: "Calls" });

test("an agent calls, stays connected across pages, hangs up and logs the outcome", async ({
  page,
}) => {
  await signIn(page, "AGENT", "/leads");
  await openLead(page, "Owned Customer Contacted");
  await panel(page).getByRole("button", { name: "Call", exact: true }).click();
  const card = page.getByRole("region", { name: "Current call" });
  await expect(card.getByRole("status")).toHaveText("Connected");

  // The call carries on while moving around.
  await page.getByRole("link", { name: "Follow-ups" }).first().click();
  await expect(page.getByRole("link", { name: /On a call/ })).toBeVisible();
  await page.getByRole("link", { name: /On a call/ }).click();

  await page
    .getByRole("region", { name: "Current call" })
    .getByRole("button", { name: "Hang up" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("How did the call go?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save outcome" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Interested", exact: true }).click();
  await dialog.getByLabel("Notes").fill("Wants a houseboat");
  await dialog.getByRole("button", { name: "Save outcome" }).click();
  await expect(panel(page).getByText(/Outcome: Interested — Wants a houseboat/)).toBeVisible();
});

test("a busy line ends clearly, and cancelling is recorded", async ({ page }) => {
  await signIn(page, "AGENT", "/leads");
  await page.evaluate(() => sessionStorage.setItem("fakeCallResult", "busy"));
  await openLead(page, "Owned Customer Qualified");
  await panel(page).getByRole("button", { name: "Call", exact: true }).click();
  await expect(panel(page).getByText(/Busy/)).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => sessionStorage.setItem("fakeCallResult", "stay"));
  await panel(page).getByRole("button", { name: "Call", exact: true }).click();
  await page
    .getByRole("region", { name: "Current call" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(panel(page).getByText(/Cancelled/)).toBeVisible({ timeout: 15_000 });
});

test("a blocked microphone says what to do, and offers the phone instead (P7-CALL-05, -08)", async ({
  page,
}) => {
  await signIn(page, "AGENT", "/leads");
  await page.evaluate(() => sessionStorage.setItem("fakeMic", "denied"));
  await page.reload();
  await openLead(page, "Owned Customer New");
  await expect(panel(page).getByRole("alert")).toContainText("microphone is blocked");
  await expect(panel(page).getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Call via my phone" })).toBeVisible();
});

test("the recording appears for a manager, and an agent is told it's managers only (P7-REC)", async ({
  browser,
}) => {
  const agent = await (await browser.newContext()).newPage();
  await signIn(agent, "AGENT", "/leads");
  await openLead(agent, "Owned Customer Quote sent");
  await panel(agent).getByRole("button", { name: "Call", exact: true }).click();
  const hangUp = agent
    .getByRole("region", { name: "Current call" })
    .getByRole("button", { name: "Hang up" });
  await hangUp.click();
  await agent.getByRole("dialog").getByRole("button", { name: "Skip for now" }).click();
  await expect(panel(agent).getByText(/visible to managers only/)).toBeVisible({ timeout: 30_000 });

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, "MANAGER", "/leads");
  await openLead(manager, "Owned Customer Quote sent");
  const audio = panel(manager).getByLabel("Call recording").first(); // the newest call
  await expect(audio).toBeVisible();
  const source = await audio.getAttribute("src");
  const response = await manager.request.get(source as string, {
    headers: { range: "bytes=0-99" },
  });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toBe("audio/mpeg");
});

test("an incoming call pops up for its owner; declined it's missed, and answered it connects", async ({
  browser,
  baseURL,
}) => {
  const headers = { origin: baseURL as string };
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, "ADMIN", "/settings");
  // Whatever the time of this run, it's within working hours.
  for (const [key, value] of [
    ["telephony.workingDays", "0,1,2,3,4,5,6"],
    ["telephony.workingFrom", "00:00"],
    ["telephony.workingTo", "23:59"],
  ]) {
    const saved = await admin.request.patch("/api/settings", { headers, data: { key, value } });
    expect(saved.status()).toBe(200);
  }

  const agent = await (await browser.newContext()).newPage();
  await signIn(agent, "AGENT", "/leads");
  const ring = async () => {
    const answer = await agent.request.post("/api/telephony/fake", {
      headers,
      data: { inboundFrom: "+919000110001" },
    });
    return (await answer.json()).data;
  };

  const first = await ring();
  expect(first.decision.action).toBe("ring");
  const popup = agent.getByRole("alertdialog");
  await expect(popup).toContainText("Incoming call");
  await popup.getByRole("button", { name: "Decline" }).click();
  await expect(popup).toHaveCount(0);

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, "MANAGER", "/calls?filter=missed");
  await expect(manager.getByText("Missed").nth(1)).toBeVisible({ timeout: 15_000 });

  await ring();
  await popup.getByRole("button", { name: "Answer" }).click();
  await expect(popup).toHaveCount(0);
  await expect(agent.getByRole("link", { name: /On a call/ })).toBeVisible();
});
