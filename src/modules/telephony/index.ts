// Public API of the telephony module: the only entry point for other modules and the worker.
import { telephonyRepository } from "./telephony.repository";

export { telephonyEventTypes } from "./telephony.events";
export { telephonyJobs, telephonySchedules } from "./telephony.jobs";
export const contactOnActiveCall = telephonyRepository.hasActiveCall;
export const eraseContactCalls = telephonyRepository.eraseCalls;
export const eraseTelephonyWebhookEvents = telephonyRepository.eraseWebhookEvents;
export const exportContactCalls = telephonyRepository.exportCalls;
export const lockCallPhone = (tx: Parameters<typeof telephonyRepository.lock>[0], phone: string) =>
  telephonyRepository.lock(tx, [`phone:${phone}`]);
