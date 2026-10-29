// The typed error services and controllers throw. Its public message always comes from the
// catalog; `cause` and `logContext` are for the server log only and are never returned.
import { ERROR_CATALOG, type ErrorCode } from "./errorCatalog";
import type { FieldError } from "@/shared/api/apiResponse";

export interface AppErrorOptions {
  fieldErrors?: FieldError[];
  cause?: unknown;
  /** Extra server-log detail, e.g. the missing permission code for FORBIDDEN. */
  logContext?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly fieldErrors?: FieldError[];
  readonly logContext?: Record<string, unknown>;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.publicMessage = ERROR_CATALOG[code].message;
    this.fieldErrors = options.fieldErrors;
    this.logContext = options.logContext;
  }
}
