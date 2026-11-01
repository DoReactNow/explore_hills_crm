// Public API of the notifications module: the only entry point for other modules and the worker.
export { notificationEventTypes } from "./notifications.events";
export { notificationJobs, notificationSchedules } from "./notifications.jobs";
export { getWorkingCalendar, notify } from "./notifications.service";
import { notificationRepository } from "./notifications.repository";
export const eraseLeadNotifications = notificationRepository.eraseForLeads;
export { addWorkingMinutes, createWorkingClock } from "./notifications.workingTime";
