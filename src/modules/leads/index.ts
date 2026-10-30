// Public API of the leads module: the only entry point for other modules.
export { ensureDefaultStages } from "./leads.stages.service";
export { leadService } from "./leads.service";
export { leadScopeOf } from "./leads.access";
export { recordFirstResponse, resolveLeadForInbound, setContactOpt } from "./leads.inbound";
export { addLeadTimeline, findLeadForChat, scopeWhere, touchLeadActivity } from "./leads.public";
export type { LeadScope, Tx as LeadsTx } from "./leads.repository";
export { normalisePhone } from "./leads.phone";
