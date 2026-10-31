// Reports and dashboards (Decision 65). Numbers are worked out live: nothing is copied, so they can't
// drift from the leads themselves. Every lead counts under its current owner and its current stage.
import { recordAudit } from "@/modules/audit";
import { getVisibleAgentIds } from "@/modules/identity";
import { addWorkingMinutes, createWorkingClock, getWorkingCalendar } from "@/modules/notifications";
import { getSetting } from "@/modules/system";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { resolveScope, type ScopePermissions } from "@/shared/rbac/scope";
import {
  addBusinessDays,
  businessDateToDbDate,
  businessDayRange,
  businessZone,
  dbDateToBusinessDate,
  formatInstant,
  systemClock,
  todayBusinessDate,
  type BusinessDate,
  type Clock,
} from "@/shared/time";
import { CSV_BOM, csvRow } from "./reporting.csv";
import { reportingRepository as repository, type ReportWhere } from "./reporting.repository";
import type { DashboardInput, ExportInput, ReportFilters } from "./reporting.schemas";

export interface ReportContext {
  principal: Principal;
  requestId?: string;
}

const REPORT_SCOPE: ScopePermissions = {
  own: "leads:view-own",
  team: "leads:view-team",
  all: "leads:view-all",
};
const DASHBOARD_SCOPE: ScopePermissions = {
  own: "dashboard:view-own",
  team: "dashboard:view-team",
  all: "dashboard:view-all",
};
const RESPONSE_BANDS = [
  { label: "0–5 min", to: 5 },
  { label: "5–10 min", to: 10 },
  { label: "10–15 min", to: 15 },
  { label: "15–30 min", to: 30 },
  { label: "30–60 min", to: 60 },
  { label: "Over 60 min", to: Number.POSITIVE_INFINITY },
];
const MAX_RANGE_DAYS = 366;
const EXPORT_BATCH = 1000;

const refused = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });

/** Percent to one decimal place, and zero rather than an error when there's nothing to divide by. */
const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

function daysBetween(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const days: BusinessDate[] = [];
  for (let day = from; day <= to; day = addBusinessDays(day, 1)) days.push(day);
  return days;
}

function zeroFilled(
  rows: Array<{ day: string; count: bigint }>,
  from: BusinessDate,
  to: BusinessDate,
) {
  const counts = new Map(rows.map((row) => [row.day, Number(row.count)]));
  return daysBetween(from, to).map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

interface Deps {
  clock?: Clock;
}

export function createReportingService({ clock = systemClock }: Deps = {}) {
  /** Whose leads a report covers. Filters can only narrow it, never widen it. */
  async function resolveWhere(principal: Principal, filters: ReportFilters): Promise<ReportWhere> {
    if (filters.to < filters.from)
      throw refused("to", "The end date can't be before the start date.");
    if (daysBetween(filters.from, filters.to).length > MAX_RANGE_DAYS) {
      throw refused("to", "Please choose a range of a year or less.");
    }
    const visible = await getVisibleAgentIds(principal, REPORT_SCOPE);
    let ownerIds: string[] | null = visible === "all" ? null : visible;
    const narrow = (ids: string[]) => {
      ownerIds = ownerIds ? ownerIds.filter((id) => ids.includes(id)) : ids;
    };
    if (filters.teamId) {
      narrow((await repository.teamMemberIds(filters.teamId)).map((row) => row.userId));
    }
    if (filters.agentId) narrow([filters.agentId]);
    return {
      start: businessDayRange(filters.from).start,
      end: businessDayRange(filters.to).end,
      ownerIds,
      source: filters.source,
      zone: businessZone(),
    };
  }

  async function responseStats(where: ReportWhere) {
    const target = (await getSetting("sla.firstResponseMinutes")) as number;
    const calendar = await getWorkingCalendar();
    const now = clock.now();
    const rows = await repository.responseRows(where);
    const minutes: number[] = [];
    const byOwner = new Map<string, number[]>();
    const workingClock = createWorkingClock(calendar);
    const dueBy = new Map<number, Date | null>();
    let noResponse = 0;
    let missed = 0;
    for (const row of rows) {
      if (row.firstResponseAt) {
        const taken = workingClock.minutesBetween(row.createdAt, row.firstResponseAt);
        minutes.push(taken);
        if (taken > target) missed += 1;
        if (row.ownerUserId) {
          const list = byOwner.get(row.ownerUserId);
          if (list) list.push(taken);
          else byOwner.set(row.ownerUserId, [taken]);
        }
      } else {
        noResponse += 1;
        // Still waiting and past its deadline counts as missed; a closed lead with no reply doesn't.
        if (!row.isOpen) continue;
        const created = row.createdAt.getTime();
        if (!dueBy.has(created))
          dueBy.set(created, addWorkingMinutes(row.createdAt, target, calendar));
        const due = dueBy.get(created);
        if (due && now.getTime() > due.getTime()) missed += 1;
      }
    }
    const within = minutes.filter((value) => value <= target).length;
    const bands = RESPONSE_BANDS.map((band) => ({ label: band.label, count: 0 }));
    for (const value of minutes) {
      bands[RESPONSE_BANDS.findIndex((band) => value <= band.to)].count += 1;
    }
    return {
      targetMinutes: target,
      median: median(minutes),
      responded: minutes.length,
      noResponse,
      missed,
      withinTargetPercent: percent(within, minutes.length),
      bands,
      medianByOwner: new Map([...byOwner].map(([id, values]) => [id, median(values)])),
    };
  }

  async function agentRows(
    where: ReportWhere,
    response: Awaited<ReturnType<typeof responseStats>>,
  ) {
    const [rows, calls] = await Promise.all([
      repository.perAgent(where),
      repository.callsPerAgent(where),
    ]);
    const callsBy = new Map(calls.map((row) => [row.userId, row]));
    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      deactivated: row.status === "DEACTIVATED",
      leads: Number(row.leads),
      firstReplyMedian: response.medianByOwner.get(row.userId) ?? null,
      calls: Number(callsBy.get(row.userId)?.calls ?? 0),
      quoted: Number(row.quoted),
      won: Number(row.won),
      value: row.value?.toString() ?? "0",
      conversionPercent: percent(Number(row.won), Number(row.leads)),
    }));
  }

  async function report(where: ReportWhere, filters: ReportFilters) {
    const response = await responseStats(where);
    const [days, funnel, sources, destinations, modes, agents] = await Promise.all([
      repository.leadsPerDay(where),
      repository.funnel(where),
      repository.bySource(where),
      repository.byDestination(where, 8),
      repository.assignmentsByMode(where),
      agentRows(where, response),
    ]);
    const stages = funnel.map((row) => ({
      code: row.code,
      name: row.name,
      kind: row.kind,
      count: Number(row.count),
    }));
    const total = stages.reduce((sum, stage) => sum + stage.count, 0);
    const won = stages.filter((stage) => stage.kind === "WON").reduce((sum, s) => sum + s.count, 0);
    const lost = stages
      .filter((stage) => stage.kind === "LOST")
      .reduce((sum, s) => sum + s.count, 0);
    const value = funnel
      .filter((row) => row.kind === "WON")
      .reduce((sum, row) => sum + Number(row.value ?? 0), 0);
    const responseView = {
      targetMinutes: response.targetMinutes,
      median: response.median,
      responded: response.responded,
      noResponse: response.noResponse,
      missed: response.missed,
      withinTargetPercent: response.withinTargetPercent,
      bands: response.bands,
    };
    return {
      from: filters.from,
      to: filters.to,
      totals: {
        leads: total,
        won,
        lost,
        value: value.toFixed(2),
        conversionPercent: percent(won, total),
      },
      perDay: zeroFilled(days, filters.from, filters.to),
      stages,
      sources: sources.map((row) => ({ source: row.source, count: Number(row.count) })),
      destinations: destinations.map((row) => ({
        destination: row.destination,
        count: Number(row.count),
      })),
      modes: modes.map((row) => ({ mode: row.mode, count: Number(row.count) })),
      response: responseView,
      agents,
    };
  }

  return {
    async getReport({ principal }: ReportContext, filters: ReportFilters) {
      assertCan(principal, "reports:view");
      return report(await resolveWhere(principal, filters), filters);
    },

    async listFilterOptions({ principal }: ReportContext) {
      assertCan(principal, "reports:view");
      const canSeeAll = resolveScope(principal, REPORT_SCOPE) === "all";
      return { teams: canSeeAll ? await repository.listTeams() : [] };
    },

    /** Own, team or company, by permission. Unassigned leads belong to no team, so they're counted
     * in the queue figure and only in company totals (Decision 65). */
    async getDashboard({ principal }: ReportContext, input: DashboardInput) {
      const scope = resolveScope(principal, DASHBOARD_SCOPE);
      if (scope === "none") {
        throw new AppError("FORBIDDEN", { logContext: { principalId: principal.userId } });
      }
      const visible = await getVisibleAgentIds(principal, DASHBOARD_SCOPE);
      const ownerIds = visible === "all" ? null : visible;
      const today = todayBusinessDate(clock);
      const days = input.range === "today" ? 0 : Number(input.range) - 1;
      const from = addBusinessDays(today, -days);
      const where: ReportWhere = {
        start: businessDayRange(from).start,
        end: businessDayRange(today).end,
        ownerIds,
        zone: businessZone(),
      };
      const weekStart = addBusinessDays(today, -6);
      const weekWhere = { ...where, start: businessDayRange(weekStart).start };
      const todayDb = businessDateToDbDate(today);
      const response = await responseStats(where);
      const [open, overdue, dueToday, calls, week, funnel, agents, openByAgent, upNext] =
        await Promise.all([
          repository.openLeads(ownerIds),
          repository.followUpsCount(
            ownerIds,
            null,
            businessDateToDbDate(addBusinessDays(today, -1)),
          ),
          repository.followUpsCount(ownerIds, todayDb, todayDb),
          repository.callsPerAgent(where),
          repository.callsPerDay(weekWhere),
          repository.funnel(where),
          scope === "own" ? [] : agentRows(where, response),
          scope === "own" ? [] : repository.openByAgent(ownerIds),
          repository.nextFollowUps(ownerIds, 5),
        ]);
      const leads = funnel.reduce((sum, row) => sum + Number(row.count), 0);
      const won = funnel
        .filter((row) => row.kind === "WON")
        .reduce((sum, row) => sum + Number(row.count), 0);
      const quoted = funnel
        .filter((row) => row.code === "QUOTED")
        .reduce((sum, row) => sum + Number(row.count), 0);
      const value = funnel
        .filter((row) => row.kind === "WON")
        .reduce((sum, row) => sum + Number(row.value ?? 0), 0);
      const canAssign = can(principal, "leads:assign");
      const openBy = new Map(openByAgent.map((row) => [row.ownerUserId, row._count._all]));
      return {
        scope,
        range: input.range,
        today,
        leads,
        open,
        overdue,
        dueToday,
        quoted,
        won,
        value: value.toFixed(2),
        conversionPercent: percent(won, leads),
        calls: calls.reduce((sum, row) => sum + Number(row.calls), 0),
        talkSeconds: calls.reduce((sum, row) => sum + Number(row.talk ?? 0), 0),
        callsPerDay: zeroFilled(week, weekStart, today),
        firstReplyMedian: response.median,
        targetMinutes: response.targetMinutes,
        missedSla: response.missed,
        queue: scope !== "own" && canAssign ? await repository.queueSize() : null,
        waiting: scope !== "own" && canAssign ? await repository.longestWaiting(5) : [],
        agents: agents.map((agent) => ({ ...agent, open: openBy.get(agent.userId) ?? 0 })),
        upNext: upNext.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: dbDateToBusinessDate(task.dueDate),
          overdue: dbDateToBusinessDate(task.dueDate) < today,
          assignee: task.assignee.name,
          leadId: task.lead.id,
          customer: task.lead.contact.name,
        })),
      };
    },

    /** The same numbers as the screen. Runs in batches as it streams, so size can't harm the server. */
    async exportCsv(context: ReportContext, input: ExportInput): Promise<Response> {
      const { principal, requestId } = context;
      assertCan(principal, "reports:export");
      assertCan(principal, "reports:view");
      const { kind, ...filters } = input;
      const where = await resolveWhere(principal, filters);
      await getPrisma().$transaction((tx) =>
        recordAudit(tx, {
          action: "reports.exported",
          entityType: "report",
          entityId: kind,
          summary: "Report exported",
          actor: { userId: principal.userId, roleCode: principal.roleCode },
          requestId,
          metadata: { kind, from: filters.from, to: filters.to },
        }),
      );
      const encoder = new TextEncoder();
      const lines = async function* (): AsyncGenerator<string> {
        yield CSV_BOM;
        if (kind === "leads") {
          yield csvRow([
            "Created",
            "Customer",
            "Phone",
            "Source",
            "Destination",
            "Travellers",
            "Budget",
            "Stage",
            "Owner",
            "First reply",
          ]);
          let after: string | null = null;
          for (;;) {
            const page: Awaited<ReturnType<typeof repository.exportLeads>> =
              await repository.exportLeads(where, after, EXPORT_BATCH);
            for (const lead of page) {
              yield csvRow([
                formatInstant(lead.createdAt, "dateTime"),
                lead.contact.name,
                lead.contact.phoneE164,
                lead.source,
                lead.destination,
                lead.travellerCount,
                lead.budgetAmount?.toString(),
                lead.stage.name,
                lead.owner?.name ?? "Unassigned",
                lead.firstResponseAt ? formatInstant(lead.firstResponseAt, "dateTime") : null,
              ]);
            }
            if (page.length < EXPORT_BATCH) return;
            after = page[page.length - 1].id;
          }
        }
        const data = await report(where, filters);
        if (kind === "volume") {
          yield csvRow(["Day", "Leads"]);
          for (const row of data.perDay) yield csvRow([row.day, row.count]);
        } else if (kind === "assignment") {
          yield csvRow(["Mode", "Assignments"]);
          for (const row of data.modes) yield csvRow([row.mode, row.count]);
        } else if (kind === "response") {
          yield csvRow(["First reply", "Leads"]);
          for (const row of data.response.bands) yield csvRow([row.label, row.count]);
          yield csvRow(["No reply yet", data.response.noResponse]);
        } else if (kind === "funnel") {
          yield csvRow(["Stage", "Leads"]);
          for (const row of data.stages) yield csvRow([row.name, row.count]);
        } else {
          yield csvRow([
            "Agent",
            "Leads",
            "First reply median (min)",
            "Calls",
            "At quote",
            "Booked",
            "Conversion %",
            "Booking value",
          ]);
          for (const row of data.agents) {
            yield csvRow([
              row.name,
              row.leads,
              row.firstReplyMedian,
              row.calls,
              row.quoted,
              row.won,
              row.conversionPercent,
              row.value,
            ]);
          }
        }
      };
      const source = lines();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await source.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${kind}-${filters.from}-to-${filters.to}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    },
  };
}

export const reportingService = createReportingService();
