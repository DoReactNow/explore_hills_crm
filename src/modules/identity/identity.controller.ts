// HTTP side of the identity module. Imported only by src/app (architecture rule 2).
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import type { HandlerResult, RouteContext } from "@/shared/http/route";
import { can } from "@/shared/rbac/guard";
import { PERMISSION_CODES, type PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import type {
  CreateRoleInput,
  CreateTeamInput,
  CreateUserInput,
  ListUsersInput,
  SetPasswordInput,
  ResetRoleInput,
  SignInInput,
  TeamMemberInput,
  UpdateRoleInput,
  UpdateTeamInput,
  UpdateUserInput,
} from "./identity.schemas";
import { userService } from "./identity.users.service";
import { readSessionToken } from "@/shared/http/sessionCookie";
import { buildSessionCookie, clearSessionCookie, clientIp } from "./identity.auth.helpers";
import { authService } from "./identity.auth.service";
import { roleService } from "./identity.roles.service";
import { teamService } from "./identity.teams.service";
import { toUserView, type UserView } from "./identity.users.repository";

export {
  createRoleSchema,
  createTeamSchema,
  createUserSchema,
  resetRoleSchema,
  teamMemberSchema,
  updateRoleSchema,
  updateTeamSchema,
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
  ): Promise<HandlerResult<UserView>> {
    const ip = clientIp(context.request.headers, getEnv().TRUSTED_PROXY_HOPS);
    const { user, token } = await authService.signIn(context.input, {
      ip,
      requestId: context.requestId,
    });
    return {
      data: toUserView(user),
      headers: { "set-cookie": buildSessionCookie(token, isSecure()) },
    };
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
  ): Promise<HandlerResult<UserView & { permissions: PermissionCode[] }>> {
    const user = await userService.getOwnProfile(userContext(context));
    const permissions = PERMISSION_CODES.filter((code) => can(context.principal, code));
    return { data: { ...toUserView(user), permissions } };
  },

  async listUsers(context: RouteContext<ListUsersInput, Record<string, string>>) {
    return { data: await userService.listUsers(userContext(context), context.input) };
  },

  async getUser(context: RouteContext<undefined, IdParams>) {
    return { data: await userService.getUser(userContext(context), context.params.id) };
  },

  async createUser(
    context: RouteContext<CreateUserInput, Record<string, string>>,
  ): Promise<HandlerResult<UserView>> {
    return {
      status: 201,
      data: toUserView(await userService.createUser(userContext(context), context.input)),
    };
  },

  async updateUser(
    context: RouteContext<UpdateUserInput, IdParams>,
  ): Promise<HandlerResult<UserView>> {
    return {
      data: toUserView(
        await userService.updateUser(userContext(context), context.params.id, context.input),
      ),
    };
  },

  async deactivateUser(
    context: RouteContext<undefined, IdParams>,
  ): Promise<HandlerResult<UserView>> {
    return {
      data: toUserView(await userService.deactivateUser(userContext(context), context.params.id)),
    };
  },

  async reactivateUser(
    context: RouteContext<undefined, IdParams>,
  ): Promise<HandlerResult<UserView>> {
    return {
      data: toUserView(await userService.reactivateUser(userContext(context), context.params.id)),
    };
  },

  async setPassword(
    context: RouteContext<SetPasswordInput, IdParams>,
  ): Promise<HandlerResult<UserView>> {
    return {
      data: toUserView(
        await userService.setPassword(userContext(context), context.params.id, context.input),
      ),
    };
  },

  async listTeams(context: RouteContext<undefined, Record<string, string>>) {
    return { data: await teamService.listTeams(userContext(context)) };
  },

  async getTeam(context: RouteContext<undefined, IdParams>) {
    return { data: await teamService.getTeam(userContext(context), context.params.id) };
  },

  async createTeam(context: RouteContext<CreateTeamInput, Record<string, string>>) {
    return { status: 201, data: await teamService.createTeam(userContext(context), context.input) };
  },

  async updateTeam(context: RouteContext<UpdateTeamInput, IdParams>) {
    return {
      data: await teamService.updateTeam(userContext(context), context.params.id, context.input),
    };
  },

  async deleteTeam(context: RouteContext<undefined, IdParams>) {
    await teamService.deleteTeam(userContext(context), context.params.id);
    return { data: { deleted: true } };
  },

  async addTeamMember(context: RouteContext<TeamMemberInput, IdParams>) {
    return {
      data: await teamService.addMember(
        userContext(context),
        context.params.id,
        context.input.userId,
      ),
    };
  },

  async removeTeamMember(context: RouteContext<undefined, IdParams & { userId: string }>) {
    return {
      data: await teamService.removeMember(
        userContext(context),
        context.params.id,
        context.params.userId,
      ),
    };
  },

  async listRoles(context: RouteContext<undefined, Record<string, string>>) {
    return { data: await roleService.listRoles(userContext(context)) };
  },

  async roleOptions(context: RouteContext<undefined, Record<string, string>>) {
    return { data: await roleService.roleOptions(userContext(context)) };
  },

  async createRole(context: RouteContext<CreateRoleInput, Record<string, string>>) {
    return { status: 201, data: await roleService.createRole(userContext(context), context.input) };
  },

  async updateRole(context: RouteContext<UpdateRoleInput, IdParams>) {
    return {
      data: await roleService.updateRole(userContext(context), context.params.id, context.input),
    };
  },

  async deleteRole(context: RouteContext<undefined, IdParams>) {
    await roleService.deleteRole(userContext(context), context.params.id);
    return { data: { deleted: true } };
  },

  async resetRole(context: RouteContext<ResetRoleInput, IdParams>) {
    return {
      data: await roleService.resetRole(
        userContext(context),
        context.params.id,
        context.input.version,
      ),
    };
  },
};
