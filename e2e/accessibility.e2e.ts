// P11-OBS-07: automated accessibility checks on every main screen, on a desk and on a phone. These catch
// what a machine can (contrast, names, labels, structure); they don't replace trying it with a screen reader.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { plantCustomer, removePlanted } from "./support/plantCustomer";
import { seededUser, signInThroughForm } from "./support/signInUser";

const SCREENS = [
  "/",
  "/leads",
  "/inbox",
  "/follow-ups",
  "/queue",
  "/blast",
  "/assignment-rules",
  "/calls",
  "/notifications",
  "/reports",
  "/employees",
  "/teams",
  "/roles",
  "/templates",
  "/settings",
  "/privacy",
  "/audit",
  "/diagnostics",
];

async function expectAccessible(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator("main").first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const found = violations.map(
    (rule) =>
      `${path} ${rule.id}: ${rule.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
  );
  expect(found, found.join("\n")).toEqual([]);
}

// Screens with rows in them show far more than empty ones do.
const planted: string[] = [];
test.beforeAll(async () => {
  planted.push(await plantCustomer(seededUser("SUPER_ADMIN").email, "Asha Sharma"));
  const unassigned = await plantCustomer(seededUser("SUPER_ADMIN").email, "Rohan Mehta");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`UPDATE leads_leads SET "ownerUserId" = NULL WHERE id = $1`, [unassigned]);
  await client.end();
  planted.push(unassigned);
});
test.afterAll(() => removePlanted(planted));

test.describe("signed out", () => {
  for (const path of ["/sign-in", "/privacy-notice"]) {
    test(`${path} passes`, async ({ page }) => {
      await expectAccessible(page, path);
    });
  }
});

for (const [device, viewport] of [
  ["desk", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/sign-in");
      await signInThroughForm(page, seededUser("SUPER_ADMIN"));
      await page.setViewportSize(viewport);
    });
    for (const path of SCREENS) {
      test(`${path} passes`, async ({ page }) => {
        await expectAccessible(page, path);
      });
    }
  });
}
