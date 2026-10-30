import { describe, expect, it } from "vitest";
import { parseInstant } from "@/shared/time";
import {
  buildSessionCookie,
  clearSessionCookie,
  clientIp,
  hashSessionToken,
  newSessionToken,
  sessionExpiry,
} from "../identity.auth.helpers";

const headers = (value?: string) => new Headers(value ? { "x-forwarded-for": value } : {});

describe("clientIp (P1-LOCK-10, -11)", () => {
  it("takes the address our own server added, ignoring what the caller faked", () => {
    expect(clientIp(headers("6.6.6.6, 1.2.3.4"), 0)).toBe("1.2.3.4");
  });

  it("counts from the right past trusted proxies", () => {
    expect(clientIp(headers("6.6.6.6, 1.2.3.4, 10.0.0.1"), 1)).toBe("1.2.3.4");
  });

  it("cannot be framed: a faked address never wins over the real one", () => {
    expect(clientIp(headers("9.9.9.9, 1.2.3.4"), 0)).not.toBe("9.9.9.9");
  });

  it.each([undefined, "", "not-an-ip", "1.2.3.4"])(
    "gives the unknown bucket for %s with too few hops",
    (value) => {
      const hops = value === "1.2.3.4" ? 3 : 0;
      expect(clientIp(headers(value), hops)).toBe("unknown");
    },
  );

  it("reads IPv6", () => {
    expect(clientIp(headers("2001:db8::1"), 0)).toBe("2001:db8::1");
  });
});

describe("session tokens (P1-SESSION-08)", () => {
  it("are 32 random bytes, and differ each time", () => {
    const token = newSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(newSessionToken()).not.toEqual(token);
  });

  it("are stored only as a SHA-256 hash", () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toEqual(hashSessionToken(token));
  });
});

describe("sessionExpiry (Decision 46)", () => {
  const signedIn = parseInstant("2026-10-01T00:00:00.000Z");

  it("is 12 hours after activity", () => {
    expect(sessionExpiry(signedIn, signedIn).toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("never passes 7 days after sign-in", () => {
    const late = parseInstant("2026-10-07T20:00:00.000Z");
    expect(sessionExpiry(signedIn, late).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("the session cookie (P1-CSRF-05)", () => {
  it("is HttpOnly and SameSite=Lax, and Secure only in production", () => {
    const cookie = buildSessionCookie("abc", false);
    expect(cookie).toMatch(/^eh_session=abc;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(buildSessionCookie("abc", true)).toContain("Secure");
  });

  it("can be cleared", () => {
    expect(clearSessionCookie(false)).toMatch(/^eh_session=;.*Max-Age=0/);
  });
});
