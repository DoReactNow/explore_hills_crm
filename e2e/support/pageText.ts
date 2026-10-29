import { expect, type Page } from "@playwright/test";

// Text that must never reach a user: stacks, SQL, library names, connection errors (Decision 8).
const BANNED = [
  /\bat \S+ \(/,
  /stack/i,
  /\bselect\b.+\bfrom\b/i,
  /prisma/i,
  /ECONN/,
  /postgres/i,
  /undefined/,
  /deliberate/i,
];

export async function expectNoTechnicalText(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const pattern of BANNED) expect(text).not.toMatch(pattern);
}
