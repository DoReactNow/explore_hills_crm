// The route() wrapper every src/app/api/**/route.ts uses:
//   export const POST = route({ access, input, handler: controller.fn })
// Order: request ID → (W-005: principal + access check) → input parsing → handler → envelope.
// Anything thrown becomes the friendly error envelope (W-004).
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { AppError } from "@/shared/errors/AppError";
import { GENERIC_FIELD_MESSAGE } from "@/shared/errors/errorCatalog";
import { parseInput, toErrorResponse } from "@/shared/errors/toErrorResponse";
import { logger as rootLogger, type Logger } from "@/shared/logger";

/** W-003/W-004 support public routes only; W-005 adds 'authenticated', { permission } and { anyOf }. */
export type Access = "public";

export interface RouteContext<I, P> {
  request: Request;
  requestId: string;
  params: P;
  input: I;
  logger: Logger;
}

export interface HandlerResult<T> {
  data: T;
  status?: number;
}

export interface RouteOptions<T, I, P> {
  access: Access;
  /** Validates the JSON body (or the query string for GET, HEAD and DELETE). */
  input?: z.ZodType<I>;
  handler: (context: RouteContext<I, P>) => Promise<HandlerResult<T>>;
}

export type NextRouteHandler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;

const QUERY_METHODS = new Set(["GET", "HEAD", "DELETE"]);

async function readRawInput(request: Request): Promise<unknown> {
  if (QUERY_METHODS.has(request.method)) {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "_root", message: GENERIC_FIELD_MESSAGE }],
    });
  }
}

export function route<T, I = undefined, P extends object = Record<string, string>>(
  options: RouteOptions<T, I, P>,
): NextRouteHandler<P> {
  return async (request, context) => {
    const requestId = randomUUID();
    const logger = rootLogger.child({ requestId });
    const headers = { "x-request-id": requestId };
    try {
      const input = options.input
        ? parseInput(options.input, await readRawInput(request))
        : (undefined as I);
      const result = await options.handler({
        request,
        requestId,
        params: await context.params,
        input,
        logger,
      });
      return Response.json({ data: result.data }, { status: result.status ?? 200, headers });
    } catch (error) {
      const { status, body } = toErrorResponse(error, { requestId, logger });
      return Response.json(body, { status, headers });
    }
  };
}
