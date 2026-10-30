// Maps every failure the browser can see to a fixed friendly sentence (Decision 8).
// Messages always come from the catalog by code; text sent by the server is never shown,
// except the friendly per-field messages of a VALIDATION_FAILED or CONFLICT response.
import {
  ERROR_CATALOG,
  NETWORK_ERROR_MESSAGE,
  isErrorCode,
  type ErrorCode,
} from "@/shared/errors/errorCatalog";
import type { FieldError } from "./apiResponse";

export type FriendlyErrorCode = ErrorCode | "NETWORK_ERROR";

declare const friendlyBrand: unique symbol;

/** Only toFriendlyError() creates this type, so UI can only render mapped text. */
export type FriendlyError = {
  readonly code: FriendlyErrorCode;
  readonly message: string;
  readonly fieldErrors?: readonly FieldError[];
  readonly requestId?: string;
} & { readonly [friendlyBrand]: true };

export interface FailureInput {
  status?: number;
  body?: unknown;
  networkError?: boolean;
  /** A reference to show, e.g. Next's error digest on the error page. */
  reference?: string;
}

const REFERENCE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_FIELD_MESSAGE = 300;

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  503: "UPSTREAM_UNAVAILABLE",
};

function readErrorObject(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined;
  const error = (body as { error: unknown }).error;
  return error && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
}

function readFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FieldError =>
      !!item &&
      typeof item === "object" &&
      typeof item.field === "string" &&
      typeof item.message === "string" &&
      item.message.length <= MAX_FIELD_MESSAGE,
  );
}

export function toFriendlyError(input: FailureInput): FriendlyError {
  if (input.networkError) {
    return { code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE } as FriendlyError;
  }

  const error = readErrorObject(input.body);
  const code: ErrorCode = isErrorCode(error?.code)
    ? error.code
    : (STATUS_CODES[input.status ?? 500] ?? "INTERNAL_ERROR");

  const reference = [input.reference, error?.requestId].find(
    (value): value is string => typeof value === "string" && REFERENCE.test(value),
  );
  const fieldErrors =
    code === "VALIDATION_FAILED" || code === "CONFLICT" ? readFieldErrors(error?.fieldErrors) : [];

  return {
    code,
    message: ERROR_CATALOG[code].message,
    ...(fieldErrors.length > 0 ? { fieldErrors } : {}),
    ...(reference ? { requestId: reference } : {}),
  } as FriendlyError;
}
