// Calls a Next.js route handler in-process with a real Request, the way Next.js would.
// The URL origin is only a placeholder: nothing is sent over the network.
const ORIGIN = "http://127.0.0.1";

type RouteHandler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

export interface CallRouteOptions<P> {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  params?: P;
}

export interface RouteResult<B = unknown> {
  status: number;
  headers: Headers;
  body: B | null;
}

export async function callRoute<B = unknown, P extends object = Record<string, string>>(
  handler: RouteHandler<P>,
  { method = "GET", path, headers = {}, body, params }: CallRouteOptions<P>,
): Promise<RouteResult<B>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json", ...headers };
  }
  const response = await handler(new Request(new URL(path, ORIGIN), init), {
    params: Promise.resolve((params ?? {}) as P),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === "" ? null : (JSON.parse(text) as B),
  };
}
