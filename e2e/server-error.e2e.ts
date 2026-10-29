// Critical journey 8 (Decision 29): the friendly server-error page, using the test-only page
// that throws while rendering (it is a 404 outside APP_ENV=test).
import { expect, test } from "@playwright/test";
import { expectNoTechnicalText } from "./support/pageText";

test("a server error shows the friendly error page with a reference", async ({ page }) => {
  await page.goto("/test-support/server-error");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something went wrong");
  await expect(page.getByText("Something went wrong on our side. Please try again.")).toBeVisible();
  await expect(page.getByText(/^Reference: \S+$/)).toBeVisible();
  await expectNoTechnicalText(page);
});
