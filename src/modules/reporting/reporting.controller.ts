// HTTP adapters for the report routes. No business rules here.
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import type { DashboardInput, ExportInput, ReportFilters } from "./reporting.schemas";
import { reportingService as service } from "./reporting.service";

export { dashboardSchema, exportSchema, reportFiltersSchema } from "./reporting.schemas";

type NoParams = Record<string, string>;

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

export const reportingController = {
  async getReport(c: RouteContext<ReportFilters, NoParams>) {
    return { data: await service.getReport(context(c), c.input) };
  },
  async listFilterOptions(c: RouteContext<undefined, NoParams>) {
    return { data: await service.listFilterOptions(context(c)) };
  },
  async getDashboard(c: RouteContext<DashboardInput, NoParams>) {
    return { data: await service.getDashboard(context(c), c.input) };
  },
  async exportCsv(c: RouteContext<ExportInput, NoParams>) {
    return { response: await service.exportCsv(context(c), c.input) };
  },
};
