import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors";
import {
  assertPasswordStrength,
  checkPasswordStrength,
  createPasswordHasher,
  hashPassword,
  MAX_PASSWORD_BYTES,
  verifyPassword,
} from "../identity.passwords";

const STRONG = "Correct-Horse-Battery-9";

describe("hashPassword and verifyPassword", () => {
  it("verifies the right password and refuses a wrong one (P1-PASS-01)", async () => {
    const hash = await hashPassword(STRONG);
    expect(await verifyPassword(STRONG, hash)).toBe(true);
    expect(await verifyPassword("Correct-Horse-Battery-8", hash)).toBe(false);
  });

  it("stores argon2id, with a different hash each time (P1-PASS-01)", async () => {
    const [first, second] = await Promise.all([hashPassword(STRONG), hashPassword(STRONG)]);
    expect(first.startsWith("$argon2id$")).toBe(true);
    expect(first).not.toEqual(second);
  });

  it("matches exactly: case and spaces matter", async () => {
    const hash = await hashPassword(STRONG);
    expect(await verifyPassword(STRONG.toLowerCase(), hash)).toBe(false);
    expect(await verifyPassword(`${STRONG} `, hash)).toBe(false);
  });

  it("treats a malformed stored hash as a failed check, not an error (P1-PASS-04)", async () => {
    for (const stored of ["", "not-a-hash", "$argon2id$broken"]) {
      await expect(verifyPassword(STRONG, stored), stored).resolves.toBe(false);
    }
  });

  it("works with emoji and non-English passwords (P1-SIGNIN-07)", async () => {
    for (const password of ["Pahad-मेरा-2026", "Hills🏔️-and-Valleys-9", "Grüße-Für-Dich-77"]) {
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash), password).toBe(true);
    }
  });

  it("matches the same characters typed in a different Unicode form", async () => {
    const hash = await hashPassword("Café-Hills-2026".normalize("NFC"));
    expect(await verifyPassword("Café-Hills-2026".normalize("NFD"), hash)).toBe(true);
  });
});

describe("a password over the size limit (P1-SIGNIN-06)", () => {
  const tooLong = "a".repeat(MAX_PASSWORD_BYTES + 1);
  const fakePrimitives = () => ({
    hash: vi.fn(async () => "$argon2id$fake"),
    verify: vi.fn(async () => true),
  });

  it("is refused by verify without any hashing", async () => {
    const primitives = fakePrimitives();
    const hasher = createPasswordHasher(primitives);
    expect(await hasher.verifyPassword(tooLong, "$argon2id$fake")).toBe(false);
    expect(primitives.verify).not.toHaveBeenCalled();
  });

  it("is refused by hash without any hashing, as a validation error", async () => {
    const primitives = fakePrimitives();
    const hasher = createPasswordHasher(primitives);
    await expect(hasher.hashPassword(tooLong)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(primitives.hash).not.toHaveBeenCalled();
  });

  it("counts bytes, not characters", () => {
    const emoji = "🏔".repeat(Math.floor(MAX_PASSWORD_BYTES / 4) + 1);
    expect(checkPasswordStrength(`Aa1-${emoji}`)).toMatchObject({ ok: false });
  });
});

describe("an unknown user", () => {
  it("still costs one verify against a dummy hash, and always fails", async () => {
    const primitives = {
      hash: vi.fn(async () => "$argon2id$dummy"),
      verify: vi.fn(async () => true),
    };
    const hasher = createPasswordHasher(primitives);
    expect(await hasher.verifyPassword(STRONG, null)).toBe(false);
    expect(primitives.verify).toHaveBeenCalledTimes(1);
    expect(primitives.verify).toHaveBeenCalledWith("$argon2id$dummy", STRONG, expect.anything());
  });

  it("builds the dummy hash once", async () => {
    const primitives = {
      hash: vi.fn(async () => "$argon2id$dummy"),
      verify: vi.fn(async () => false),
    };
    const hasher = createPasswordHasher(primitives);
    await Promise.all([hasher.verifyPassword(STRONG, null), hasher.verifyPassword(STRONG, null)]);
    expect(primitives.hash).toHaveBeenCalledTimes(1);
  });
});

describe("limited concurrency (P1-PASS-06)", () => {
  it("never runs more than the limit at once, and finishes every request", async () => {
    let running = 0;
    let peak = 0;
    const track = async <T>(value: T): Promise<T> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      return value;
    };
    const hasher = createPasswordHasher(
      { hash: () => track("$argon2id$fake"), verify: () => track(true) },
      { maxConcurrent: 3 },
    );

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        index % 2 ? hasher.hashPassword(STRONG) : hasher.verifyPassword(STRONG, "$argon2id$fake"),
      ),
    );

    expect(peak).toBe(3);
    expect(results).toHaveLength(12);
  });

  it("keeps working after a failed hash", async () => {
    const hash = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("$argon2id$fake");
    const hasher = createPasswordHasher({ hash, verify: async () => true }, { maxConcurrent: 1 });
    await expect(hasher.hashPassword(STRONG)).rejects.toThrow("boom");
    await expect(hasher.hashPassword(STRONG)).resolves.toBe("$argon2id$fake");
  });
});

describe("checkPasswordStrength (P1-PASS-02)", () => {
  it("accepts a strong password", () => {
    expect(checkPasswordStrength(STRONG)).toEqual({ ok: true });
    expect(checkPasswordStrength("Pahad-मेरा-2026")).toEqual({ ok: true });
  });

  it("refuses short, single-class, placeholder and common passwords", () => {
    for (const password of [
      "",
      "short1A!",
      "alllowercaseletters",
      "change-me-before-seeding",
      "Password1234",
      "Qwerty-Hills-2026",
    ]) {
      expect(checkPasswordStrength(password), password).toMatchObject({ ok: false });
    }
  });

  it("gives a friendly message that never repeats the password", () => {
    const password = "alllowercaseletters";
    const result = checkPasswordStrength(password);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).not.toContain(password);
      expect(result.message).toMatch(/at least 12 characters/i);
    }
  });
});

describe("a password built from the user's own details (P1-PASS-03)", () => {
  const user = { email: "Anil.Kumar@example.com", name: "Anil Kumar" };

  it("is refused when it contains the email, its local part, the name or a name part", () => {
    for (const password of [
      "Anil.Kumar@example.com1",
      "xX-anil.kumar-2026",
      "Anil Kumar 2026!",
      "Kumar-Hills-2026",
    ]) {
      expect(checkPasswordStrength(password, user), password).toMatchObject({ ok: false });
    }
  });

  it("is accepted when it shares nothing with them", () => {
    expect(checkPasswordStrength(STRONG, user)).toEqual({ ok: true });
  });

  it("ignores name parts too short to mean anything", () => {
    expect(checkPasswordStrength(STRONG, { name: "Bo Or" })).toEqual({ ok: true });
  });
});

describe("assertPasswordStrength", () => {
  it("throws VALIDATION_FAILED with a message on the password field", () => {
    try {
      assertPasswordStrength("weak");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("VALIDATION_FAILED");
      expect(appError.fieldErrors?.[0]?.field).toBe("password");
      expect(JSON.stringify(appError.fieldErrors)).not.toContain("weak");
    }
  });

  it("passes a strong password", () => {
    expect(() => assertPasswordStrength(STRONG)).not.toThrow();
  });
});
