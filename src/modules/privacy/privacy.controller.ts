// HTTP adapters for the privacy routes. No business rules here.
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import type { ConsentInput, EraseInput, HoldInput, SearchInput } from "./privacy.schemas";
import { privacyService as service } from "./privacy.service";

export { consentSchema, eraseSchema, holdSchema, searchSchema } from "./privacy.schemas";

type IdParams = { id: string };

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

export const privacyController = {
  async search(c: RouteContext<SearchInput, Record<string, string>>) {
    return { data: await service.search(context(c), c.input) };
  },
  async getRecord(c: RouteContext<undefined, IdParams>) {
    return { data: await service.getRecord(context(c), c.params.id) };
  },
  async recordConsent(c: RouteContext<ConsentInput, IdParams>) {
    return { data: await service.recordConsent(context(c), c.params.id, c.input) };
  },
  async setHold(c: RouteContext<HoldInput, IdParams>) {
    return { data: await service.setHold(context(c), c.params.id, c.input) };
  },
  async exportData(c: RouteContext<undefined, IdParams>) {
    return { response: await service.exportData(context(c), c.params.id) };
  },
  async erase(c: RouteContext<EraseInput, IdParams>) {
    return { data: await service.erase(context(c), c.params.id, c.input) };
  },
};
