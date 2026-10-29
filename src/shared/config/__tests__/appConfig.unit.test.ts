import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "../appConfig";

describe("APP_CONFIG", () => {
  it("exposes the product, company, support and locale values", () => {
    expect(APP_CONFIG.product.name).toEqual(expect.any(String));
    expect(APP_CONFIG.company.legalName).toEqual(expect.any(String));
    expect(APP_CONFIG.support.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(APP_CONFIG.support.phoneE164).toMatch(/^\+[1-9][0-9]{6,14}$/);
    expect(APP_CONFIG.locale.businessTimezone).toBe("Asia/Kolkata");
    expect(APP_CONFIG.locale.locale).toEqual(expect.any(String));
    expect(APP_CONFIG.locale.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("derives the display and tel: forms from the E.164 phone", () => {
    const digits = APP_CONFIG.support.phoneE164.replace(/\D/g, "");
    expect(APP_CONFIG.support.phoneTelHref).toBe(`tel:${APP_CONFIG.support.phoneE164}`);
    expect(APP_CONFIG.support.phoneDisplay.replace(/\D/g, "")).toBe(digits);
    expect(APP_CONFIG.support.phoneDisplay).not.toBe(APP_CONFIG.support.phoneE164);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(APP_CONFIG)).toBe(true);
    expect(Object.isFrozen(APP_CONFIG.support)).toBe(true);
    expect(Object.isFrozen(APP_CONFIG.locale)).toBe(true);
  });
});
