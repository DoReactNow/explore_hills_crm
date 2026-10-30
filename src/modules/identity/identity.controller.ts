// HTTP side of the identity module. Imported only by src/app (architecture rule 2).
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import type { HandlerResult, RouteContext } from "@/shared/http/route";
import { can } from "@/shared/rbac/guard";
import { PERMISSION_CODES, type PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import type {
  CreateUserInput,
  ListUsersInput,
  SetPasswordInput,
  SignInInput,
  UpdateUserInput,
} from "./identity.schemas";
import { userService } from "./identity.users.service";
import { readSessionToken } from "@/shared/http/sessionCookie";
import { buildSessionCookie, clearSessionCookie, clientIp } from "./identity.auth.helpers";
import { authService } from "./identity.auth.service";
import type { PublicUser } from "./identity.users.repository";

export {
  createUserSchema,
  listUsersSchema,
  setPasswordSchema,
  signInSchema,
  updateUserSchema,
} from "./identity.schemas";

type IdParams = { id: string };

function userContext<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal: principal satisfies Principal, requestId };
}

const isSecure = () => getEnv().APP_ENV === "production";

export const identityController = {
  async signIn(
    context: RouteContext<SignInInput, Record<string, string>>,
  ): Promise<HandlerResult<PublicUser>> {
    const ip = clientIp(context.request.headers, getEnv().TRUSTED_PROXY_HOPS);
    const { user, token } = await authService.signIn(context.input, {
      ip,
      requestId: context.requestId,
    });
    return { data: user, headers: { "set-cookie": buildSessionCookie(token, isSecure()) } };
  },

  async signOut(
    context: RouteContext<undefined, Record<string, string>>,
  ): Promise<HandlerResult<{ signedOut: true }>> {
    await authService.signOut(readSessionToken(context.request.headers), context.requestId);
    return { data: { signedOut: true }, headers: { "set-cookie": clearSessionCookie(isSecure()) } };
  },

  /** `permissions` lists what this person can do, so the browser never needs the bypass flag. */
  async me(
    context: RouteContext<undefined, Record<string, string>>,
  ): Promise<HandlerResult<PublicUser & { permissions: PermissionCode[] }>> {
    const user = await userService.getOwnProfile(userContext(context));
    const permissions = PERMISSION_CODES.filter((code) => can(context.principal, code));
    return { data: { ...user, permissions } };
  },

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
