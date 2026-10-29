import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/errors/AppError";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
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
    expect(second.headers.get("x-request-id")).toBe(seen[1]);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("turns a thrown AppError into the error envelope with the same request ID", async () => {
    const handler = route({
      access: "public",
      handler: async () => {
        throw new AppError("NOT_FOUND");
      },
    });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: ERROR_CATALOG.NOT_FOUND.message,
        requestId: result.headers.get("x-request-id"),
      },
    });
  });

  it("turns an unexpected error into INTERNAL_ERROR without leaking it", async () => {
    const handler = route({
      access: "public",
      handler: async () => {
        throw new Error("SELECT * FROM secrets failed");
      },
    });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SELECT");
  });

  it("parses the JSON body with the input schema and passes typed input to the handler", async () => {
    const handler = route({
      access: "public",
      input: z.object({ name: z.string().min(1, { error: "Enter a name." }) }),
      handler: async ({ input }) => ({ data: { hello: input.name } }),
    });
    const ok = await callRoute(handler, { method: "POST", path: "/api/x", body: { name: "Riya" } });
    expect(ok.body).toEqual({ data: { hello: "Riya" } });

    const bad = await callRoute(handler, { method: "POST", path: "/api/x", body: { name: "" } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fieldErrors: [{ field: "name", message: "Enter a name." }],
      },
    });
  });

  it("parses query parameters for GET and rejects a malformed JSON body as VALIDATION_FAILED", async () => {
    const handler = route({
      access: "public",
      input: z.object({ page: z.coerce.number().int().min(1) }),
      handler: async ({ input }) => ({ data: input.page }),
    });
    expect((await callRoute(handler, { path: "/api/x?page=3" })).body).toEqual({ data: 3 });

    const post = route({
      access: "public",
      input: z.object({}),
      handler: async () => ({ data: 1 }),
    });
    const malformed = await post(
      new Request("http://127.0.0.1/api/x", {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(malformed.status).toBe(400);
  });
});
