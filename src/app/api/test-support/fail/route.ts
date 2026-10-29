// TEST-ONLY route that throws an unexpected error, to prove the friendly 500 envelope.
// Outside APP_ENV=test it answers 404 NOT_FOUND.
import { route } from "@/shared/http/route";
import { assertTestEnvironment } from "@/shared/http/testOnly";

export const GET = route({
  access: "public",
  handler: async () => {
    assertTestEnvironment();
    throw new Error("deliberate failure (test-only route)");
  },
});
