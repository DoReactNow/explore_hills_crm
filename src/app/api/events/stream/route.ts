// GET /api/events/stream: the live-update stream for the signed-in user (Decision 28).
import { assignmentEventTypes } from "@/modules/assignment";
import { leadEventTypes } from "@/modules/leads";
import { messagingEventTypes } from "@/modules/messaging";
import { systemEventTypes, systemTestEventTypes } from "@/modules/system";
import { route } from "@/shared/http/route";
import { isTestEnvironment } from "@/shared/http/testOnly";
import { resolvePrincipal } from "@/shared/rbac/principalResolver";
import { assembleEventTypes, type AnyEventType } from "@/shared/realtime";
import { createEventStream } from "@/shared/realtime/sse";

export const runtime = "nodejs";

// Assembled on first use, not at import, so `next build` needs no environment.
let eventTypes: Map<string, AnyEventType> | undefined;
function allEventTypes() {
  eventTypes ??= assembleEventTypes({
    assignment: assignmentEventTypes,
    leads: leadEventTypes,
    messaging: messagingEventTypes,
    system: [...systemEventTypes, ...(isTestEnvironment() ? systemTestEventTypes : [])],
  });
  return eventTypes;
}

export const GET = route({
  access: "authenticated",
  handler: async ({ request }) => ({
    response: createEventStream({
      resolveCurrentPrincipal: () => resolvePrincipal(request),
      types: allEventTypes(),
      signal: request.signal,
    }),
  }),
});
