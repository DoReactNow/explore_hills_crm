// TEST-ONLY page that fails while rendering, for the server-error E2E spec.
// Outside APP_ENV=test it is a normal 404.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isTestEnvironment } from "@/shared/http/testOnly";

export default async function ServerErrorProbePage() {
  await connection(); // render per request, never at build time
  if (!isTestEnvironment()) notFound();
  throw new Error("deliberate render failure (test-only page)");
}
