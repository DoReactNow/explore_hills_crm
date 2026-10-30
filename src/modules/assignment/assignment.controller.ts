// HTTP adapters for the assignment routes. No business rules here.
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import type {
  AgentSettingsInput,
  AutoRuleInput,
  CommitInput,
  DeactivateChoice,
  ListQueueInput,
  PreviewInput,
  ReassignInput,
} from "./assignment.schemas";
import { assignmentService as service } from "./assignment.service";

export {
  agentSettingsSchema,
  autoRuleSchema,
  commitSchema,
  deactivateSchema,
  listQueueSchema,
  previewSchema,
  reassignSchema,
} from "./assignment.schemas";

type NoParams = Record<string, string>;
type IdParams = { id: string };

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = ({ params }: { params: IdParams }) => {
  if (!UUID.test(params.id)) throw new AppError("NOT_FOUND");
  return params.id;
};

export const assignmentController = {
  async listQueue(c: RouteContext<ListQueueInput, NoParams>) {
    return { data: await service.listQueue(context(c), c.input) };
  },
  async listAgents(c: RouteContext<undefined, NoParams>) {
    return { data: await service.listAgents(context(c)) };
  },
  async updateAgentSettings(c: RouteContext<AgentSettingsInput, IdParams>) {
    return { data: await service.updateAgentSettings(context(c), idOf(c), c.input) };
  },
  async openLeadCount(c: RouteContext<undefined, IdParams>) {
    return { data: await service.openLeadCount(context(c), idOf(c)) };
  },
  async preview(c: RouteContext<PreviewInput, NoParams>) {
    return { data: await service.preview(context(c), c.input) };
  },
  async commit(c: RouteContext<CommitInput, NoParams>) {
    return { data: await service.commit(context(c), c.input) };
  },
  async undo(c: RouteContext<undefined, IdParams>) {
    return { data: await service.undo(context(c), idOf(c)) };
  },
  async listPool(c: RouteContext<undefined, NoParams>) {
    return { data: await service.listPool(context(c)) };
  },
  async claim(c: RouteContext<undefined, IdParams>) {
    return { data: await service.claim(context(c), idOf(c)) };
  },
  async cancelPoolEntry(c: RouteContext<undefined, IdParams>) {
    return { data: await service.cancelPoolEntry(context(c), idOf(c)) };
  },
  async reassign(c: RouteContext<ReassignInput, IdParams>) {
    return { data: await service.reassign(context(c), idOf(c), c.input) };
  },
  async deactivateUser(c: RouteContext<DeactivateChoice, IdParams>) {
    return { data: await service.deactivateUser(context(c), idOf(c), c.input) };
  },
  async getAutoRule(c: RouteContext<undefined, NoParams>) {
    return { data: await service.getAutoRule(context(c)) };
  },
  async setAutoRule(c: RouteContext<AutoRuleInput, NoParams>) {
    return { data: await service.setAutoRule(context(c), c.input) };
  },
};
