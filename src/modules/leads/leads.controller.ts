// HTTP side of the leads module. Imported only by src/app (architecture rule 2).
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import type {
  AddNoteInput,
  AddTaskInput,
  CreateLeadInput,
  CreateStageInput,
  ListFollowUpsInput,
  ListLeadsInput,
  MoveStageInput,
  SetTaskInput,
  UpdateLeadInput,
  UpdateStageInput,
} from "./leads.schemas";
import { leadService } from "./leads.service";
import { stageService } from "./leads.stages.service";
import { taskService } from "./leads.tasks.service";

export {
  addNoteSchema,
  addTaskSchema,
  createLeadSchema,
  createStageSchema,
  listFollowUpsSchema,
  listLeadsSchema,
  moveStageSchema,
  setTaskSchema,
  updateLeadSchema,
  updateStageSchema,
} from "./leads.schemas";

type NoParams = Record<string, string>;
type IdParams = { id: string };

function leadContext<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

export const leadsController = {
  async listLeads(context: RouteContext<ListLeadsInput, NoParams>) {
    return { data: await leadService.listLeads(leadContext(context), context.input) };
  },
  async createLead(context: RouteContext<CreateLeadInput, NoParams>) {
    return { status: 201, data: await leadService.createLead(leadContext(context), context.input) };
  },
  async getLead(context: RouteContext<undefined, IdParams>) {
    return { data: await leadService.getLead(leadContext(context), context.params.id) };
  },
  async updateLead(context: RouteContext<UpdateLeadInput, IdParams>) {
    return {
      data: await leadService.updateLead(leadContext(context), context.params.id, context.input),
    };
  },
  async deleteLead(context: RouteContext<undefined, IdParams>) {
    await leadService.deleteLead(leadContext(context), context.params.id);
    return { data: { deleted: true } };
  },
  async moveStage(context: RouteContext<MoveStageInput, IdParams>) {
    return {
      data: await leadService.moveStage(leadContext(context), context.params.id, context.input),
    };
  },
  async addNote(context: RouteContext<AddNoteInput, IdParams>) {
    return {
      status: 201,
      data: await leadService.addNote(leadContext(context), context.params.id, context.input),
    };
  },
  async addTask(context: RouteContext<AddTaskInput, IdParams>) {
    return {
      status: 201,
      data: await taskService.addTask(leadContext(context), context.params.id, context.input),
    };
  },
  async setTask(context: RouteContext<SetTaskInput, IdParams & { taskId: string }>) {
    return {
      data: await taskService.setCompleted(
        leadContext(context),
        context.params.id,
        context.params.taskId,
        context.input,
      ),
    };
  },
  async listFollowUps(context: RouteContext<ListFollowUpsInput, NoParams>) {
    return { data: await taskService.listFollowUps(leadContext(context), context.input) };
  },
  async listStages() {
    return { data: await stageService.listStages() };
  },
  async createStage(context: RouteContext<CreateStageInput, NoParams>) {
    return {
      status: 201,
      data: await stageService.createStage(leadContext(context), context.input),
    };
  },
  async updateStage(context: RouteContext<UpdateStageInput, IdParams>) {
    return {
      data: await stageService.updateStage(leadContext(context), context.params.id, context.input),
    };
  },
  async deleteStage(context: RouteContext<undefined, IdParams>) {
    await stageService.deleteStage(leadContext(context), context.params.id);
    return { data: { deleted: true } };
  },
};
