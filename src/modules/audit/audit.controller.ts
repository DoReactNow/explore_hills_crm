// HTTP adapters for the audit trail routes. No business rules here.
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import type { AuditFilters, AuditListInput } from "./audit.schemas";
import { auditViewsService as service } from "./audit.views.service";

export { auditFiltersSchema, auditListSchema } from "./audit.schemas";

type NoParams = Record<string, string>;

function principalOf<I, P>({ principal }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return principal;
}

export const auditController = {
  async list(c: RouteContext<AuditListInput, NoParams>) {
    return { data: await service.list(principalOf(c), c.input) };
  },
  async options(c: RouteContext<undefined, NoParams>) {
    return { data: await service.options(principalOf(c)) };
  },
  async exportCsv(c: RouteContext<AuditFilters, NoParams>) {
    return { response: await service.exportCsv(principalOf(c), c.requestId, c.input) };
  },
};
