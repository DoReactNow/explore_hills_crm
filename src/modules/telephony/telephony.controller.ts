// HTTP adapters for the telephony routes. No business rules here.
import { randomUUID } from "node:crypto";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import { systemClock } from "@/shared/time";
import { fakeProviderHeaders } from "./providers/registry.server";
import type {
  EndCallInput,
  EndpointInput,
  FakeControlInput,
  ListCallsInput,
  OutcomeInput,
  StartCallInput,
} from "./telephony.schemas";
import { telephonyService as service } from "./telephony.service";

export {
  endCallSchema,
  endpointSchema,
  fakeControlSchema,
  listCallsSchema,
  outcomeSchema,
  startCallSchema,
} from "./telephony.schemas";

type NoParams = Record<string, string>;
type IdParams = { id: string };

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

export const telephonyController = {
  async softphone(c: RouteContext<undefined, NoParams>) {
    return { data: await service.softphone(context(c)) };
  },
  async heartbeat(c: RouteContext<undefined, NoParams>) {
    return { data: await service.heartbeat(context(c)) };
  },
  async goOffline(c: RouteContext<undefined, NoParams>) {
    return { data: await service.goOffline(context(c)) };
  },
  async startCall(c: RouteContext<StartCallInput, IdParams>) {
    return { status: 201, data: await service.startCall(context(c), c.params.id, c.input) };
  },
  async listLeadCalls(c: RouteContext<undefined, IdParams>) {
    return { data: await service.listLeadCalls(context(c), c.params.id) };
  },
  async listCalls(c: RouteContext<ListCallsInput, NoParams>) {
    return { data: await service.listCalls(context(c), c.input) };
  },
  async currentCall(c: RouteContext<undefined, NoParams>) {
    return { data: await service.currentCall(context(c)) };
  },
  async getCall(c: RouteContext<undefined, IdParams>) {
    return { data: await service.getCall(context(c), c.params.id) };
  },
  async endCall(c: RouteContext<EndCallInput, IdParams>) {
    return { data: await service.endCall(context(c), c.params.id, c.input) };
  },
  async answer(c: RouteContext<undefined, IdParams>) {
    return { data: await service.answer(context(c), c.params.id) };
  },
  async decline(c: RouteContext<undefined, IdParams>) {
    return { data: await service.decline(context(c), c.params.id) };
  },
  async saveOutcome(c: RouteContext<OutcomeInput, IdParams>) {
    return { data: await service.saveOutcome(context(c), c.params.id, c.input) };
  },
  async retryRecording(c: RouteContext<undefined, IdParams>) {
    return { data: await service.retryRecording(context(c), c.params.id) };
  },
  async playRecording(c: RouteContext<undefined, IdParams>) {
    return {
      response: await service.playRecording(
        context(c),
        c.params.id,
        c.request.headers.get("range"),
      ),
    };
  },
  async saveEndpoint(c: RouteContext<EndpointInput, IdParams>) {
    return { data: await service.saveEndpoint(context(c), c.params.id, c.input) };
  },

  /** Provider-facing: a plain status, because the provider reads nothing else. */
  async receiveWebhook({ request }: RouteContext<undefined, NoParams>) {
    const status = await service.handleWebhook(await request.text(), request.headers);
    return { response: new Response("", { status }) };
  },
  async routeInbound({ request }: RouteContext<undefined, NoParams>) {
    return { response: await service.routeInbound(await request.text(), request.headers) };
  },

  /** Plays the part of the provider for the fake softphone. Never available in production. */
  async fakeControl(c: RouteContext<FakeControlInput, NoParams>) {
    if (getEnv().APP_ENV === "production" || getEnv().TELEPHONY_PROVIDER !== "fake") {
      throw new AppError("NOT_FOUND");
    }
    const { callRef, callId, status, duration, recording, inboundFrom } = c.input;
    const providerCallId = callId ?? (callRef ? `fake-${callRef}` : `fake-${randomUUID()}`);
    if (inboundFrom !== undefined) {
      const raw = JSON.stringify({ callId: providerCallId, from: inboundFrom || null });
      const answer = await service.routeInbound(raw, fakeProviderHeaders(raw));
      return { data: { providerCallId, decision: (await answer.json()) as unknown } };
    }
    const raw = JSON.stringify({
      events: [
        {
          id: randomUUID(),
          callId: providerCallId,
          ref: callRef,
          status,
          duration,
          recording,
          at: systemClock.now().toISOString(),
        },
      ],
    });
    await service.handleWebhook(raw, fakeProviderHeaders(raw));
    return { data: { providerCallId, decision: null as unknown } };
  },
};
