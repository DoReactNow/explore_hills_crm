// Turns anything thrown into the friendly error envelope. Technical detail goes to the log
// with the requestId; the body only ever holds the catalog message.
import { z } from "zod";
import type { ApiErrorBody, FieldError } from "@/shared/api/apiResponse";
import type { Logger } from "@/shared/logger";
import { AppError } from "./AppError";
import { GENERIC_FIELD_MESSAGE } from "./errorCatalog";

export interface ErrorResponseContext {
  requestId: string;
  logger: Pick<Logger, "warn" | "error">;
}

function toFieldErrors(issues: z.core.$ZodIssue[]): FieldError[] {
  const seen = new Set<string>();
  const result: FieldError[] = [];
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "_root";
    if (seen.has(field)) continue;
    seen.add(field);
    result.push({ field, message: issue.message });
  }
  return result;
}

/**
 * Validates input. Messages a schema defines itself are kept; anything left at a library
 * default becomes GENERIC_FIELD_MESSAGE, so Zod's own wording never reaches a user.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value, { error: () => GENERIC_FIELD_MESSAGE });
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: toFieldErrors(result.error.issues) });
  }
  return result.data;
}

export function toErrorResponse(
  thrown: unknown,
  { requestId, logger }: ErrorResponseContext,
): { status: number; body: ApiErrorBody } {
  let error: AppError;
  if (thrown instanceof AppError) {
    error = thrown;
    if (error.status >= 500) {
      logger.error("request failed", { requestId, code: error.code, err: error.cause ?? error });
    } else if (error.logContext) {
      logger.warn("request refused", { requestId, code: error.code, ...error.logContext });
    }
  } else if (thrown instanceof z.ZodError) {
    error = new AppError("VALIDATION_FAILED", {
      fieldErrors: toFieldErrors(thrown.issues).map((field) => ({
        ...field,
        message: GENERIC_FIELD_MESSAGE,
      })),
    });
  } else {
    error = new AppError("INTERNAL_ERROR");
    logger.error("unexpected error", { requestId, err: thrown });
  }

  return {
    status: error.status,
    body: {
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        requestId,
      },
    },
  };
}
