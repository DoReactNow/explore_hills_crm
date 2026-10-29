import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_CATALOG, NETWORK_ERROR_MESSAGE } from "@/shared/errors/errorCatalog";
import { apiRequest } from "../client";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("returns data from a success envelope and sends JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { id: "1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiRequest<{ id: string }>("/api/things", {
      method: "POST",
      body: { a: 1 },
    });
    expect(result).toEqual({ ok: true, data: { id: "1" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("returns a friendly error for an error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: "NOT_FOUND", message: "x" } }, { status: 404 }),
        ),
    );
    const result = await apiRequest("/api/things/1");
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: ERROR_CATALOG.NOT_FOUND.message },
    });
  });

  it("returns the network sentence when fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const result = await apiRequest("/api/things");
    expect(result).toEqual({
      ok: false,
      error: { code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE },
    });
  });

  it("treats a 200 response with a non-envelope body as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })),
    );
    const result = await apiRequest("/api/things");
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });
});
