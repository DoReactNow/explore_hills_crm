// HTTP side of the identity module. Imported only by src/app (architecture rule 2).
import { AppError } from "@/shared/errors";
import type { HandlerResult, RouteContext } from "@/shared/http/route";
import type { Principal } from "@/shared/rbac/principal";
import type {
  CreateUserInput,
  ListUsersInput,
  SetPasswordInput,
  UpdateUserInput,
} from "./identity.schemas";
import { userService } from "./identity.users.service";
import type { PublicUser } from "./identity.users.repository";

export {
  createUserSchema,
  listUsersSchema,
  setPasswordSchema,
  updateUserSchema,
} from "./identity.schemas";

type IdParams = { id: string };

function userContext<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal: principal satisfies Principal, requestId };
}

export const identityController = {
  async listUsers(context: RouteContext<ListUsersInput, Record<string, string>>) {
    return { data: await userService.listUsers(userContext(context), context.input) };
  },

  async getUser(context: RouteContext<undefined, IdParams>): Promise<HandlerResult<PublicUser>> {
    return { data: await userService.getUser(userContext(context), context.params.id) };
  },

  async createUser(
    context: RouteContext<CreateUserInput, Record<string, string>>,
  ): Promise<HandlerResult<PublicUser>> {
    return { status: 201, data: await userService.createUser(userContext(context), context.input) };
  },

  async updateUser(
    context: RouteContext<UpdateUserInput, IdParams>,
  ): Promise<HandlerResult<PublicUser>> {
    return {
      data: await userService.updateUser(userContext(context), context.params.id, context.input),
    };
  },

  async deactivateUser(
    context: RouteContext<undefined, IdParams>,
  ): Promise<HandlerResult<PublicUser>> {
    return { data: await userService.deactivateUser(userContext(context), context.params.id) };
  },

  async reactivateUser(
    context: RouteContext<undefined, IdParams>,
  ): Promise<HandlerResult<PublicUser>> {
    return { data: await userService.reactivateUser(userContext(context), context.params.id) };
  },

  async setPassword(
    context: RouteContext<SetPasswordInput, IdParams>,
  ): Promise<HandlerResult<PublicUser>> {
    return {
      data: await userService.setPassword(userContext(context), context.params.id, context.input),
    };
  },
};
