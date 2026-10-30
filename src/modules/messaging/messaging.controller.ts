// HTTP side of the messaging module. Imported only by src/app (architecture rule 2).
import { leadService } from "@/modules/leads";
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import { getWhatsAppGateway } from "./gateway/registry";
import { messagingRepository } from "./messaging.repository";
import type {
  CreateTemplateInput,
  ListConversationsInput,
  ListTemplatesInput,
  SendTemplateInput,
  SendTextInput,
  UpdateTemplateInput,
} from "./messaging.schemas";
import { messagingService } from "./messaging.service";

export {
  createTemplateSchema,
  listConversationsSchema,
  listTemplatesSchema,
  sendTemplateSchema,
  sendTextSchema,
  updateTemplateSchema,
} from "./messaging.schemas";

type NoParams = Record<string, string>;
type IdParams = { id: string };

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

const text = (status: number, body = "") => new Response(body, { status });

export const messagingController = {
  /** Provider-facing: a plain status, because the provider reads nothing else. */
  async receiveWebhook({ request }: RouteContext<undefined, NoParams>) {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 2 * 1024 * 1024) return { response: text(413) };
    const status = await messagingService.handleWebhook(await request.text(), request.headers);
    return { response: text(status) };
  },

  async webhookHandshake({ request }: RouteContext<undefined, NoParams>) {
    const params = new URL(request.url).searchParams;
    return {
      response: getWhatsAppGateway().verifyHandshake(params.get("hub.verify_token"))
        ? text(200, params.get("hub.challenge") ?? "")
        : text(403),
    };
  },

  async listConversations(c: RouteContext<ListConversationsInput, NoParams>) {
    return { data: await messagingService.listConversations(context(c), c.input) };
  },
  async getConversation(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.getConversation(context(c), c.params.id) };
  },
  async markRead(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.markRead(context(c), c.params.id) };
  },
  async sendText(c: RouteContext<SendTextInput, IdParams>) {
    return { status: 201, data: await messagingService.sendText(context(c), c.params.id, c.input) };
  },
  async sendTemplate(c: RouteContext<SendTemplateInput, IdParams>) {
    return {
      status: 201,
      data: await messagingService.sendTemplate(context(c), c.params.id, c.input),
    };
  },
  async sendFile(c: RouteContext<undefined, IdParams>) {
    const form = await c.request.formData().catch(() => new FormData());
    return { status: 201, data: await messagingService.sendFile(context(c), c.params.id, form) };
  },
  async recordAgreement(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.recordAgreement(context(c), c.params.id) };
  },
  async startConversation(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.startConversation(context(c), c.params.id) };
  },
  async retry(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.retry(context(c), c.params.id) };
  },
  async openFile(c: RouteContext<undefined, IdParams>) {
    return { response: await messagingService.openFile(context(c), c.params.id) };
  },
  async listTemplates(c: RouteContext<ListTemplatesInput, NoParams>) {
    return { data: await messagingService.listTemplates(context(c), c.input) };
  },
  async createTemplate(c: RouteContext<CreateTemplateInput, NoParams>) {
    return { status: 201, data: await messagingService.createTemplate(context(c), c.input) };
  },
  async updateTemplate(c: RouteContext<UpdateTemplateInput, IdParams>) {
    return { data: await messagingService.updateTemplate(context(c), c.params.id, c.input) };
  },
  async deleteTemplate(c: RouteContext<undefined, IdParams>) {
    return { data: await messagingService.deleteTemplate(context(c), c.params.id) };
  },

  /** Merging moves chats too, so it runs from here (leads can't depend on messaging). */
  async mergeLeads(c: RouteContext<{ intoLeadId: string }, IdParams>) {
    return {
      data: await leadService.mergeLeads(
        context(c),
        c.params.id,
        c.input.intoLeadId,
        (tx, from, to) => messagingRepository.moveConversations(tx, from, to),
      ),
    };
  },
};
