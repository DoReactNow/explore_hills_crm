// Critical journey 8 (Decision 29): the friendly not-found page.
import { expect, test } from "@playwright/test";
import { expectNoTechnicalText } from "./support/pageText";

test("an unknown URL shows the friendly not-found page", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deliberately wrong heading");
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
    "href",
    "/",
  );
  await expectNoTechnicalText(page);
});
