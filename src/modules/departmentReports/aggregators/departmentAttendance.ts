/**
 * Department attendance report (`dept_att:<department_id>`, monthly only).
 *
 * Sources
 * - Team: today's roster of the department (main department or a position in
 *   it, see `departmentRoster.ts`), leaving out members hidden from event
 *   reports — the same people the church attendance report counts.
 * - Services: SERVICE events (or events with no type) of the department's
 *   branch (any branch when the department has none) that took clock-ins.
 *   Services without any clock-in are left out so they don't read as 0%.
 * - Check-ins: `event_attendance` rows of team members at those services.
 *
 * "Not checked in 2+ Sundays" counts members who missed the last two or more
 * Sunday services of the period in a row.
 */
import { prisma } from "../../../Models/context";
import { getEventReportExcludedUserIds } from "../../settings/eventReportExclusionService";
import { departmentRosters } from "../departmentRoster";
import { addDays, longDate, shortDate } from "../period";
import {
  NV,
  bars,
  flag,
  healthOf,
  inRange,
  kpi,
  list,
  nf,
  pctOf,
  pctPill,
  pill,
  round1,
  sortFlags,
  table,
} from "../sections";
import { Bucket, FlagDTO, ReportBuilder } from "../types";

export interface DepartmentRef {
  id: number;
  name: string;
  branch_id: number | null;
}

const departmentPath = (id: number) => `/home/membership/departments-and-ministries/${id}`;
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

type Service = { id: number; day: Date; sunday: boolean };
type Window = { from: Date; to: Date };

export const buildDepartmentAttendance =
  (dept: DepartmentRef): ReportBuilder =>
  async (ctx) => {
    const windowFrom = new Date(
      Math.min(ctx.from.getTime(), ctx.prev.from.getTime(), ctx.yoy.from.getTime(), ctx.trend[0]?.from.getTime() ?? ctx.from.getTime()),
    );
    const windowTo = new Date(Math.min(ctx.to.getTime(), addDays(dayStart(ctx.now), 1).getTime()));

    const excluded = await getEventReportExcludedUserIds();
    const roster = (await departmentRosters([dept.id], excluded)).get(dept.id) || new Set<number>();
    const memberIds = Array.from(roster);

    const [serviceRows, members] = await Promise.all([
      windowTo > windowFrom
        ? prisma.event_mgt.findMany({
            where: {
              ...(dept.branch_id != null ? { branch_id: dept.branch_id } : {}),
              OR: [{ event_type: "SERVICE" }, { event_type: null }],
              start_date: { gte: windowFrom, lt: windowTo },
              event_attendance: { some: {} },
            },
            select: { id: true, start_date: true },
          })
        : Promise.resolve([] as { id: number; start_date: Date | null }[]),
      memberIds.length
        ? prisma.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([] as { id: number; name: string }[]),
    ]);

    const services: Service[] = serviceRows
      .filter((s) => s.start_date)
      .map((s) => {
        const day = dayStart(s.start_date as Date);
        return { id: s.id, day, sunday: day.getUTCDay() === 0 };
      })
      .sort((a, b) => a.day.getTime() - b.day.getTime());
    const serviceById = new Map(services.map((s) => [s.id, s]));

    const checkIns =
      memberIds.length && services.length
        ? await prisma.event_attendance.groupBy({
            by: ["event_id", "user_id"],
            where: { user_id: { in: memberIds }, event_id: { in: services.map((s) => s.id) } },
            _min: { created_at: true },
          })
        : [];
    // event id → members who checked in
    const present = new Map<number, Set<number>>();
    for (const row of checkIns) {
      const set = present.get(row.event_id) || new Set<number>();
      set.add(row.user_id);
      present.set(row.event_id, set);
    }

    const within = (w: Window) => services.filter((s) => inRange(s.day, w.from, w.to));
    const rateIn = (w: Window): number | null => {
      const list = within(w);
      if (!list.length || !memberIds.length) return null;
      const hits = list.reduce((n, s) => n + (present.get(s.id)?.size ?? 0), 0);
      return round1(pctOf(hits, list.length * memberIds.length));
    };

    const period: Window = { from: ctx.from, to: ctx.to };
    const periodServices = within(period);
    const rate = rateIn(period);
    const prevRate = rateIn(ctx.prev);
    const yoyRate = rateIn(ctx.yoy);

    /* ---------- Per member ---------- */
    const lastCheckIn = new Map<number, Date>();
    for (const row of checkIns) {
      const service = serviceById.get(row.event_id);
      if (!service || service.day >= ctx.to) continue;
      const prev = lastCheckIn.get(row.user_id);
      if (!prev || service.day > prev) lastCheckIn.set(row.user_id, service.day);
    }
    const sundays = periodServices.filter((s) => s.sunday);
    const sundayDays = Array.from(new Set(sundays.map((s) => s.day.getTime()))).sort((a, b) => a - b);
    const presentOnDay = (userId: number, day: number) =>
      sundays.some((s) => s.day.getTime() === day && present.get(s.id)?.has(userId));

    const rows = members.map((m) => {
      const hits = periodServices.filter((s) => present.get(s.id)?.has(m.id)).length;
      let missedStreak = 0;
      for (let i = sundayDays.length - 1; i >= 0; i -= 1) {
        if (presentOnDay(m.id, sundayDays[i])) break;
        missedStreak += 1;
      }
      return {
        id: m.id,
        name: m.name,
        hits,
        rate: periodServices.length ? round1(pctOf(hits, periodServices.length)) : null,
        last: lastCheckIn.get(m.id) ?? null,
        missedStreak,
      };
    });
    const missing = rows.filter((r) => r.missedStreak >= 2).sort((a, b) => b.missedStreak - a.missedStreak || a.name.localeCompare(b.name));

    /* ---------- KPIs ---------- */
    const trend = ctx.trend;
    const kpis = [
      kpi("members", "Team members", memberIds.length, { good: null, sub: "Current roster" }),
      kpi("checkin_rate", "Check-in rate", rate, {
        format: "pct",
        prev: prevRate,
        yoy: yoyRate,
        good: "up",
        spark: trend.map((b: Bucket) => rateIn(b) ?? 0),
        sub: periodServices.length ? `Across ${nf(periodServices.length)} services` : "No services with check-ins",
      }),
      kpi("services", "Services held", periodServices.length, {
        prev: within(ctx.prev).length,
        yoy: within(ctx.yoy).length,
        good: null,
        spark: trend.map((b: Bucket) => within(b).length),
        sub: "Services that took check-ins",
      }),
      kpi("missing_sundays", "Not checked in 2+ Sundays", sundayDays.length >= 2 ? missing.length : null, {
        good: "down",
        sub: sundayDays.length >= 2 ? "Missed the last two Sundays or more" : "Needs two Sundays with check-ins",
      }),
    ];

    /* ---------- Flags + highlights ---------- */
    const flags: FlagDTO[] = [];
    if (rate != null && rate < 60) {
      flags.push(flag("act", `Only ${Math.round(rate)}% of the team checked in at services this month.`, "Open department", departmentPath(dept.id)));
    } else if (rate != null && rate < 75) {
      flags.push(flag("watch", `${Math.round(rate)}% of the team checked in at services this month.`, "Open department", departmentPath(dept.id)));
    }
    if (sundayDays.length >= 2 && missing.length) {
      flags.push(
        flag(
          missing.length >= Math.max(3, Math.ceil(memberIds.length / 4)) ? "act" : "watch",
          `${nf(missing.length)} ${missing.length === 1 ? "member has" : "members have"} not checked in for two Sundays or more.`,
        ),
      );
    }
    const highlights: string[] = [];
    if (rate != null) {
      const change = prevRate != null ? Math.round(rate - prevRate) : null;
      highlights.push(
        `${dept.name} checked in at ${Math.round(rate)}% of ${nf(periodServices.length)} services${
          change == null ? "" : change === 0 ? `, level with ${ctx.prev.label}` : `, ${change > 0 ? "up" : "down"} ${Math.abs(change)} points on ${ctx.prev.label}`
        }.`,
      );
    }
    const perfect = rows.filter((r) => periodServices.length && r.hits === periodServices.length).length;
    if (perfect) highlights.push(`${nf(perfect)} ${perfect === 1 ? "member" : "members"} checked in at every service.`);

    /* ---------- Sections ---------- */
    const weeks = ctx.weeks;
    const sections = [
      bars(
        "dpt-weekly",
        "Weekly check-in rate",
        "Share of the team that checked in at each week's services",
        weeks.map((w) => w.label),
        [{ name: "Check-in rate", color: NV, values: weeks.map((w) => rateIn(w) ?? 0) }],
        { note: weeks.some((w) => rateIn(w) == null) ? "Weeks without services that took check-ins show 0." : undefined },
      ),
      table(
        "dpt-members",
        "Team members",
        "Check-ins at services this month",
        [
          ["Member", "minmax(180px,1.6fr)"],
          ["Check-ins", "minmax(90px,0.8fr)", "right"],
          ["Last check-in", "minmax(110px,1fr)", "right"],
          ["Rate", "minmax(80px,0.7fr)", "right"],
        ],
        rows
          .slice()
          .sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1) || a.name.localeCompare(b.name))
          .map((r) => ({
            keys: [r.name, r.hits, r.last ? r.last.getTime() : 0, r.rate ?? -1],
            cells: [
              { text: r.name, bold: true },
              `${nf(r.hits)} of ${nf(periodServices.length)}`,
              r.last ? longDate(r.last) : "—",
              r.rate == null ? "—" : { pill: pctPill(r.rate) },
            ],
          })),
        { full: true, sortable: true, minWidth: "560px" },
      ),
      list(
        "dpt-missing",
        "Not checked in for 2+ Sundays",
        "Missed the most recent Sundays in a row",
        missing.map((r) => ({
          title: r.name,
          sub: r.last ? `Last check-in ${shortDate(r.last)}` : "No check-in on record",
          right: `${r.missedStreak} Sundays`,
          pill: r.missedStreak >= 4 ? pill("danger", "Follow up") : pill("warning", "Check in"),
          pii: true,
        })),
        { note: sundayDays.length < 2 ? "Needs at least two Sundays with check-ins this month." : undefined },
      ),
    ];

    const sorted = sortFlags(flags);
    return {
      body: {
        kpis,
        flags: sorted,
        highlights,
        sections,
        by_branch: null,
        headline: [1, 3],
        health: healthOf(sorted),
        provisional_note: ctx.to > ctx.now ? "This month is still in progress." : null,
        empty: !memberIds.length || !periodServices.length,
      },
      facts: {
        members: memberIds.length,
        checkin_rate: rate,
        services: periodServices.length,
        missing_sundays: missing.length,
      },
    };
  };
