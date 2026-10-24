/**
 * Head-of-department workspace helpers: the team roster and Sunday check-ins.
 *
 * Roster = active, non-guest users in the department through `user.department_id`,
 * `user_departments` or `department_positions` (the same three links the
 * attendance report uses), minus members hidden from event reports. Built by
 * departmentReports/departmentRoster so the HOD workspace and the department
 * attendance report count the same people.
 *
 * A Sunday counts when a SERVICE event (or one with no type) in the
 * department's branch starts that day and at least one person checked in at
 * it, so Sundays without check-in data never read as 0%.
 */
import { prisma } from "../../../Models/context";
import { departmentRosters } from "../../departmentReports/departmentRoster";
import { getEventReportExcludedUserIds } from "../../settings/eventReportExclusionService";
import { DAY, dayStart } from "./genericCommon";

export type HodPack = "media" | "evangelism" | "children" | null;

export const packFor = (name: string): HodPack => {
  const n = name.toLowerCase();
  if (n.includes("media")) return "media";
  if (n.includes("evangel")) return "evangelism";
  if (/child|kids/.test(n)) return "children";
  return null;
};

/** The department's roster (shared with the department attendance report), with names. */
export const loadRoster = async (departmentId: number) => {
  const excluded = await getEventReportExcludedUserIds();
  const ids = Array.from((await departmentRosters([departmentId], excluded)).get(departmentId) || []);
  if (!ids.length) return [] as { id: number; name: string }[];
  return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
};

/** The last `n` Sundays up to today, oldest first. */
export const lastSundays = (now: Date, n: number) => {
  const today = dayStart(now);
  const last = new Date(today.getTime() - today.getUTCDay() * DAY);
  return Array.from({ length: n }, (_, i) => new Date(last.getTime() - (n - 1 - i) * 7 * DAY));
};

export type SundayCheckins = {
  day: Date;
  /** Any check-in at a service that day (data exists). */
  hasData: boolean;
  /** Roster members who checked in. */
  present: Set<number>;
};

/** Check-ins of roster members at Sunday services, one entry per Sunday. */
export const sundayCheckins = async (
  sundays: Date[],
  rosterIds: number[],
  branchWhere: Record<string, unknown>,
): Promise<SundayCheckins[]> => {
  if (!sundays.length) return [];
  const from = sundays[0];
  const to = new Date(sundays[sundays.length - 1].getTime() + DAY);
  const events = await prisma.event_mgt.findMany({
    where: {
      ...branchWhere,
      start_date: { gte: from, lt: to },
      OR: [{ event_type: "SERVICE" }, { event_type: null }],
    },
    select: { id: true, start_date: true },
  });
  const sundayEvents = events.filter((e) => e.start_date && e.start_date.getUTCDay() === 0);
  const eventDay = new Map(sundayEvents.map((e) => [e.id, dayStart(e.start_date as Date).getTime()]));
  const ids = Array.from(eventDay.keys());
  const [anyRows, rosterRows] = ids.length
    ? await Promise.all([
        prisma.event_attendance.groupBy({ by: ["event_id"], where: { event_id: { in: ids } }, _count: { _all: true } }),
        rosterIds.length
          ? prisma.event_attendance.findMany({
              where: { event_id: { in: ids }, user_id: { in: rosterIds } },
              select: { event_id: true, user_id: true },
            })
          : Promise.resolve([] as { event_id: number; user_id: number }[]),
      ])
    : [[], []];
  const withData = new Set(anyRows.map((r) => eventDay.get(r.event_id)));
  return sundays.map((day) => {
    const key = day.getTime();
    const present = new Set(rosterRows.filter((r) => eventDay.get(r.event_id) === key).map((r) => r.user_id));
    return { day, hasData: withData.has(key), present };
  });
};
