// Public API of the leads module: the only entry point for other modules.
export { ensureDefaultStages } from "./leads.stages.service";
export { createLeadService, leadService } from "./leads.service";
export { leadScopeOf } from "./leads.access";
export { recordFirstResponse, resolveLeadForInbound, setContactOpt } from "./leads.inbound";
export {
  addLeadTimeline,
  addSystemFollowUp,
  followUpsDue,
  leadsAwaitingResponse,
  createTaskForLead,
  findLeadForCall,
  findLeadOwner,
  isLeadVisible,
  addLeadTimelines,
  countOpenLeads,
  findLeadForChat,
  findWaitingLeads,
  firstOwnerAction,
  languageOfLead,
  lockLeads,
  moveOpenTasks,
  openLeadIdsOf,
  scopeWhere,
  setLeadOwner,
  touchLeadActivity,
} from "./leads.public";
export type { LeadScope, LockedLead, Tx as LeadsTx } from "./leads.repository";
export { inScope } from "./leads.access";
export { normalisePhone } from "./leads.phone";
export { leadEventTypes } from "./leads.events";
export {
  addConsentRecord,
  anonymiseContact,
  auditConsent,
  contactHasOpenLead,
  exportContactRecord,
  findContactForChange,
  findContactRecord,
  leadIdsOfContact,
  lockContactPhone,
  recordingRefused,
  searchContacts,
  setContactHold,
  setRecordingOptOut,
} from "./leads.privacy";
