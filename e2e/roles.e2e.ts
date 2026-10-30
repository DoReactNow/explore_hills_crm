// Critical journey 1: each role signs in through the form, sees their name and only what they may
// use, and signs out. Diagnostics is shown to Super Admin and Admin and refused to the others.
import { expect, test } from "@playwright/test";
import { expectNoTechnicalText } from "./support/pageText";
import { seededUser, signInThroughForm } from "./support/signInUser";

const JOURNEYS = [
  { role: "SUPER_ADMIN", diagnostics: true },
  { role: "ADMIN", diagnostics: true },
  { role: "MANAGER", diagnostics: false },
  { role: "AGENT", diagnostics: false },
] as const;

for (const { role, diagnostics } of JOURNEYS) {
  test(`${role} signs in, reaches only what the role allows, and signs out`, async ({ page }) => {
    const user = seededUser(role);
    await page.goto("/sign-in");
    await signInThroughForm(page, user);
    await expect(page.getByText(user.name)).toBeVisible();

    const link = page.getByRole("link", { name: "Diagnostics" });
    await expect(link).toHaveCount(diagnostics ? 1 : 0);

    await page.goto("/diagnostics");
    if (diagnostics) {
      await expect(page.getByText("Database: up")).toBeVisible();
    } else {
      await expect(page.locator("main").getByRole("alert")).toContainText(
        "You don't have access to do this.",
      );
      await expect(page.getByText("Database: up")).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(
        /[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*/,
      );
      await expectNoTechnicalText(page);
    }

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/diagnostics");
    await expect(page.locator("main").getByRole("alert")).toContainText("Please sign in");
  });
}
