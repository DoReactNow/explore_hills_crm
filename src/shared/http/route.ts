// The route() wrapper every src/app/api/**/route.ts uses:
//   export const GET = route({ access, handler: controller.fn })
// W-003: request ID, logger and the { data } envelope. W-004 adds the error envelope and
// friendly errors; W-005 adds principal resolution and the access check (default deny).
import { randomUUID } from "node:crypto";
import { logger as rootLogger, type Logger } from "@/shared/logger";

/** W-003 supports public routes only; W-005 adds 'authenticated', { permission } and { anyOf }. */
export type Access = "public";

export interface RouteContext<P> {
  request: Request;
  requestId: string;
  params: P;
  logger: Logger;
}

export interface HandlerResult<T> {
  data: T;
  status?: number;
}

export interface RouteOptions<T, P> {
  access: Access;
  handler: (context: RouteContext<P>) => Promise<HandlerResult<T>>;
}

export type NextRouteHandler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;

export function route<T, P extends object = Record<string, string>>(
  options: RouteOptions<T, P>,
): NextRouteHandler<P> {
  return async (request, context) => {
    const requestId = randomUUID();
    const result = await options.handler({
      request,
      requestId,
      params: await context.params,
      logger: rootLogger.child({ requestId }),
    });
    return Response.json(
      { data: result.data },
      { status: result.status ?? 200, headers: { "x-request-id": requestId } },
    );
  };
}
