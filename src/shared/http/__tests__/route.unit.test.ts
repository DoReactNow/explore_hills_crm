import { describe, expect, it } from "vitest";
import { callRoute } from "@/tests/setup/callRoute";
import { route } from "../route";

describe("route() wrapper", () => {
  it("wraps the handler result in the { data } envelope with its status", async () => {
    const handler = route({
      access: "public",
      handler: async () => ({ status: 201, data: { ok: true } }),
    });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ data: { ok: true } });
  });

  it("defaults to status 200 and gives every response a request ID", async () => {
    const seen: string[] = [];
    const handler = route({
      access: "public",
      handler: async ({ requestId }) => {
        seen.push(requestId);
        return { data: null };
      },
    });
    const first = await callRoute(handler, { path: "/api/x" });
    const second = await callRoute(handler, { path: "/api/x" });
    expect(first.status).toBe(200);
    expect(first.headers.get("x-request-id")).toBe(seen[0]);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
