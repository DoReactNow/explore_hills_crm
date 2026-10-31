// Small assignment facts for other modules.
import { businessMoment, dbDateToBusinessDate } from "@/shared/time";
import { assignmentRepository } from "./assignment.repository";

/** Those of these people on leave at this moment, by the business date. */
export async function peopleOnLeave(userIds: readonly string[], at: Date): Promise<Set<string>> {
  const today = businessMoment(at).date;
  const settings = await assignmentRepository.findSettings(userIds);
  return new Set(
    settings
      .filter(
        (row) =>
          row.leaveFromDate &&
          row.leaveToDate &&
          dbDateToBusinessDate(row.leaveFromDate) <= today &&
          today <= dbDateToBusinessDate(row.leaveToDate),
      )
      .map((row) => row.userId),
  );
}
