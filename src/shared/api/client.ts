// The browser's only way to call the backend. Every failure comes back as a FriendlyError.
import type { ApiSuccess } from "./apiResponse";
import { toFriendlyError, type FriendlyError } from "./friendlyError";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: FriendlyError };

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /** A file upload. The browser sets its own content type. */
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function isSuccess<T>(body: unknown): body is ApiSuccess<T> {
  return !!body && typeof body === "object" && "data" in body;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body:
        options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch {
    return { ok: false, error: toFriendlyError({ networkError: true }) };
  }

  let body: unknown;
  try {
    const text = await response.text();
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }

  if (response.ok && isSuccess<T>(body)) return { ok: true, data: body.data };
  return {
    ok: false,
    error: toFriendlyError({ status: response.ok ? 500 : response.status, body }),
  };
}
