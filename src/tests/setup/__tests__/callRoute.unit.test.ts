import { describe, expect, it } from "vitest";
import { callRoute } from "../callRoute";

describe("callRoute", () => {
  it("passes method, path, headers and JSON body to the handler and reads the JSON reply", async () => {
    const handler = async (request: Request) => {
      const url = new URL(request.url);
      return Response.json(
        {
          data: {
            method: request.method,
            path: url.pathname + url.search,
            header: request.headers.get("x-test"),
            body: await request.json(),
          },
        },
        { status: 201 },
      );
    };

    const result = await callRoute(handler, {
      method: "POST",
      path: "/api/things?x=1",
      headers: { "x-test": "yes" },
      body: { name: "a" },
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      data: { method: "POST", path: "/api/things?x=1", header: "yes", body: { name: "a" } },
    });
  });

  it("defaults to GET and returns null for an empty body", async () => {
    const handler = async (request: Request) =>
      new Response(null, { status: request.method === "GET" ? 204 : 500 });
    const result = await callRoute(handler, { path: "/api/empty" });
    expect(result).toMatchObject({ status: 204, body: null });
  });

  it("passes route params to the handler context", async () => {
    const handler = async (_request: Request, context: { params: Promise<{ id: string }> }) =>
      Response.json({ data: (await context.params).id });
    const result = await callRoute(handler, { path: "/api/things/7", params: { id: "7" } });
    expect(result.body).toEqual({ data: "7" });
  });
});
