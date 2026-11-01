import { describe, expect, it } from "vitest";
import {
  API_CONTENT_SECURITY_POLICY,
  STATIC_SECURITY_HEADERS,
  createNonce,
  pageContentSecurityPolicy,
} from "../securityHeaders";

const directives = (policy: string) =>
  new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

describe("page content security policy", () => {
  const policy = directives(pageContentSecurityPolicy("abc123", { development: false }));

  it("lets only scripts carrying this request's nonce run", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it("never allows inline or evaluated scripts in production", () => {
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows evaluated scripts only in development, for React's debugging", () => {
    const dev = directives(pageContentSecurityPolicy("abc123", { development: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
  });

  it("closes framing, plugins, base tags and outside connections", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
  });

  it("keeps recordings, previews and the push worker working", () => {
    expect(policy.get("media-src")).toEqual(["'self'", "blob:"]);
    expect(policy.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(policy.get("worker-src")).toEqual(["'self'"]);
  });
});

describe("createNonce", () => {
  it("is different every time and safe inside a header", () => {
    const first = createNonce();
    expect(first).not.toBe(createNonce());
    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("static headers", () => {
  const headers = new Map(STATIC_SECURITY_HEADERS.map((header) => [header.key, header.value]));

  it("sets the protections every response needs", () => {
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{8}/);
  });

  it("keeps the microphone for this site and turns the rest off", () => {
    const value = headers.get("Permissions-Policy");
    expect(value).toContain("microphone=(self)");
    expect(value).toContain("camera=()");
    expect(value).toContain("geolocation=()");
  });

  it("gives API answers a policy that runs nothing", () => {
    expect(API_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(API_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});
