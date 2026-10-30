// The only source of user-facing error messages (Decision 8, project_data.md Section 8).
// A new failure situation gets a catalog entry here BEFORE it is used.

export const ERROR_CATALOG = {
  VALIDATION_FAILED: {
    status: 400,
    message: "Some details need fixing. Please check the highlighted fields.",
  },
  INVALID_CREDENTIALS: {
    status: 401,
    message: "That email and password don't match. Check for typos and try again.",
  },
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You don't have access to do this." },
  NOT_FOUND: { status: 404, message: "We couldn't find what you were looking for." },
  CONFLICT: {
    status: 409,
    message: "This was changed by someone else. Please refresh and try again.",
  },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Please wait a moment and try again." },
  UPSTREAM_UNAVAILABLE: {
    status: 503,
    message: "A connected service isn't responding right now. Please try again shortly.",
  },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong on our side. Please try again." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CATALOG, value);
}

/** Shown for a form field whose schema did not define its own friendly message. */
export const GENERIC_FIELD_MESSAGE = "Please check this field.";

/** Shown by the browser client when the request never reached the server. */
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Please check your connection and try again.";
