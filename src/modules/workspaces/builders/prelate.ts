/**
 * Prelate workspace: "Is the church healthy and growing?"
 *
 * KPIs reuse the department-report aggregators (attendance, membership, life
 * centers, finance) over the selected range, so the numbers match Reports.
 */
import { prisma } from "../../../Models/context";
import { getRelationBranchScopedWhere } from "../../branches/branchService";
import { computeReport } from "../../departmentReports/departmentReportService";
import { addDays, parsePeriod, periodOptions, shortDate } from "../../departmentReports/period";
import { REPORT_MAP, ReportDefinition } from "../../departmentReports/registry";
import { nf, round1 } from "../../departmentReports/sections";
import { canSignOffDeptReports } from "../access";
import type { ReportKey, ReportResult } from "../../departmentReports/types";
import {
  buildAttendanceVisitorCountsMap,
  getAttendanceVisitorCountsForRecord,
} from "../../events/attendanceVisitorCounts";
import { isLeaderRoleName } from "../../lifeCenterMangement/lifeCenterHelpers";
import { assessmentService } from "../../programs/lms/assessmentService";
import {
  DAY_MS,
  PERIOD_TYPE,
  FOLLOW_UP_WINDOW_DAYS,
  branchWhere,
  dayLabel,
  dayStart,
  findKpi,
  once,
  pendingAppointmentsForMe,
  plural,
  recentVisitors,
  requisitionsAtMyStep,
  submittedDeptReports,
  toKpi,
  visibleBranches,
} from "../queries/prelateAdmin";
import type {
  AgendaItem,
  BarRow,
  Kpi,
  ListItem,
  NeedsItem,
  Pill,
  WorkspaceBuilder,
  WorkspaceContext,
} from "../types";
import { deltaPct, runWidgets } from "../widgetKit";

const ATT_WEEKS = 12;
const LIST_LIMIT = 6;

const compareWords = (ctx: WorkspaceContext) => ctx.range.compare_label.replace(/^vs /, "on ");

export const buildPrelate: WorkspaceBuilder = async (ctx) => {
  const [canAtt, canMembers, canLc, canFin, canVisitors, canReportsAdmin] = await Promise.all([
    ctx.can("Church_Attendance", "view"),
    ctx.can("Membership_Management", "view"),
    ctx.can("Life Center", "view"),
    ctx.can("Financials", "view"),
    ctx.can("Visitors", "view"),
    // Same sign-off rule as the department reports module.
    ctx.can("Reports", "view").then(async (view) => view && canSignOffDeptReports(await ctx.grants())),
  ]);

  // Shared reads, computed at most once per request.
  // The in-progress department-report period, so results share the reports' 5-minute cache.
  const period = once(async () => {
    const type = PERIOD_TYPE[ctx.range.key];
    return parsePeriod(type, periodOptions(type, new Date())[1].key);
  });
  const runReport = async (key: ReportKey): Promise<ReportResult> =>
    computeReport(REPORT_MAP.get(key) as ReportDefinition, await period(), ctx.branchId);
  const attendance = once(() => runReport("attendance"));
  const membership = once(() => runReport("membership"));
  const lifeCenters = once(() => runReport("lifecenters"));
  const finance = once(() => runReport("finance"));
  const visitors = once(() => recentVisitors(ctx));
  const requisitions = once(() => requisitionsAtMyStep(ctx));
  const reports = once(() =>
    canReportsAdmin ? submittedDeptReports(ctx) : Promise.resolve({ total: 0, items: [] }),
  );
  const appointments = once(() => pendingAppointmentsForMe(ctx));

  const widgets = await runWidgets(ctx, [
    /* ------------------------------ p-hero ------------------------------ */
    [
      "p-hero",
      null,
      async () => {
        const lines: string[] = [];
        const range = ctx.range.label.toLowerCase();
        const [att, lc, vis, theme] = await Promise.all([
          canAtt ? attendance().catch(() => null) : null,
          canLc ? lifeCenters().catch(() => null) : null,
          canVisitors ? visitors().catch(() => null) : null,
          prisma.annualTheme
            .findFirst({
              where: {
                isActive: true,
                ...(ctx.branchId ? { OR: [{ branch_id: ctx.branchId }, { branch_id: null }] } : {}),
              },
              orderBy: [{ branch_id: "desc" }, { year: "desc" }],
              select: { title: true, verse: true, verseReference: true },
            })
            .catch(() => null),
        ]);

        const avg = findKpi(att, "avg_sunday_attendance");
        if (avg?.value != null) {
          const d = deltaPct(avg.value, avg.compare.prev);
          const trend =
            d == null ? "" : d === 0 ? `, level ${compareWords(ctx)}` : `, ${d > 0 ? "up" : "down"} ${Math.abs(d)}% ${compareWords(ctx)}`;
          lines.push(`Sunday services averaged ${nf(Math.round(avg.value))} people ${range}${trend}.`);
        } else if (att) {
          lines.push(`No Sunday headcount has been recorded ${range} yet.`);
        }

        const souls = findKpi(lc, "souls_won");
        if (lc && souls) {
          const n = souls.value ?? 0;
          const converted = Number(lc.facts.souls_became_members ?? 0);
          lines.push(
            n
              ? `${plural(n, "soul was", "souls were")} won through life centers ${range}${
                  converted ? `, and ${nf(converted)} of them ${converted === 1 ? "has" : "have"} become members` : ""
                }.`
              : `No souls won through life centers have been recorded ${range}.`,
          );
        }

        if (vis) {
          const waiting = vis.filter((v) => v.needsFollowUp);
          const unassigned = waiting.filter((v) => v.unassigned).length;
          lines.push(
            waiting.length
              ? `${plural(waiting.length, "visitor")} from the last ${FOLLOW_UP_WINDOW_DAYS} days ${
                  waiting.length === 1 ? "has" : "have"
                } not been followed up${
                  unassigned ? `, and ${nf(unassigned)} ${unassigned === 1 ? "has" : "have"} no one responsible` : ""
                }.`
              : `Every visitor from the last ${FOLLOW_UP_WINDOW_DAYS} days has been followed up.`,
          );
        }

        return {
          lines: lines.slice(0, 3),
          theme: theme?.title ?? null,
          verse: theme ? `“${theme.verse.trim()}” ${theme.verseReference}`.trim() : null,
        };
      },
    ],

    /* ------------------------------ p-sign ------------------------------ */
    [
      "p-sign",
      null,
      async () => {
        const [req, rep, appt] = await Promise.all([requisitions(), reports(), appointments()]);
        return { items: [...req.items, ...rep.items, ...appt.items] };
      },
    ],

    /* ------------------------------ p-kpi ------------------------------- */
    [
      "p-kpi",
      null,
      async () => {
        const [att, mem, lc, fin] = await Promise.all([
          canAtt ? attendance() : null,
          canMembers ? membership() : null,
          canLc ? lifeCenters() : null,
          canFin ? finance() : null,
        ]);
        const kpis: Kpi[] = [];
        if (canAtt) {
          kpis.push(
            toKpi(findKpi(att, "avg_sunday_attendance"), "avg_attendance", "Avg service attendance", {
              sub: "Sunday services",
            }),
          );
        }
        if (canMembers) {
          const active = findKpi(mem, "active_members");
          kpis.push(toKpi(active, "active_members", "Active members"));
          // Net growth = change in active members from one period to the next
          // (deactivation dates are not recorded, so this is the best available).
          const s = active?.spark ?? [];
          const growth = s.slice(1).map((v, i) => v - s[i]);
          const cur = growth.length ? growth[growth.length - 1] : null;
          const prev = growth.length > 1 ? growth[growth.length - 2] : null;
          kpis.push({
            key: "net_growth",
            label: "Net membership growth",
            value: cur,
            format: "signed",
            delta_pct: deltaPct(cur, prev),
            good: "up",
            spark: growth,
            sub: "Change in active members",
          });
        }
        if (canLc) kpis.push(toKpi(findKpi(lc, "souls_won"), "souls_won", "Souls won"));
        if (canFin) kpis.push(toKpi(findKpi(fin, "total_income"), "total_giving", "Total giving"));
        return { kpis };
      },
    ],

    /* ------------------------------ p-att ------------------------------- */
    ["p-att", ["Church_Attendance", "view"], () => attendanceTrend(ctx)],

    /* ------------------------------ p-fun ------------------------------- */
    [
      "p-fun",
      ["Visitors", "view"],
      async () => {
        const { from, to } = ctx.range;
        const [visitorCount, souls, became] = await Promise.all([
          prisma.visitor.count({ where: { ...branchWhere(ctx), visitDate: { gte: from, lte: to } } }),
          prisma.soul_won.count({
            where: {
              date_won: { gte: from, lte: to },
              ...(getRelationBranchScopedWhere(ctx.branchId, "lifeCenter") ?? {}),
            },
          }),
          prisma.user.count({
            where: {
              ...branchWhere(ctx),
              created_at: { gte: from, lte: to },
              OR: [{ source_visitor_id: { not: null } }, { source_soul_won_id: { not: null } }],
            },
          }),
        ]);
        return {
          steps: [
            { label: "Visitors", value: visitorCount },
            { label: "Souls won", value: souls },
            { label: "Became members", value: became },
          ],
        };
      },
    ],

    /* ------------------------------ p-fol ------------------------------- */
    [
      "p-fol",
      ["Visitors", "view"],
      async () => {
        const waiting = (await visitors()).filter((v) => v.needsFollowUp);
        const ordered = [...waiting.filter((v) => v.unassigned), ...waiting.filter((v) => !v.unassigned)];
        const items: ListItem[] = ordered.slice(0, LIST_LIMIT).map((v) => {
          const pill: Pill = v.unassigned
            ? { tone: "danger", label: "Not assigned" }
            : v.followUps
              ? { tone: "warning", label: "Follow-up pending" }
              : { tone: "warning", label: "Not contacted" };
          return {
            title: v.name,
            sub: `Visited ${shortDate(v.visitDate)} · ${v.responsibleName || "no responsible person"}`,
            pill,
            ref_id: v.id,
          };
        });
        return {
          need_follow_up: waiting.length,
          unassigned: waiting.filter((v) => v.unassigned).length,
          items,
        };
      },
    ],

    /* ------------------------------- p-lc ------------------------------- */
    ["p-lc", ["Life Center", "view"], () => lifeCenterHealth(ctx)],

    /* ------------------------------ p-som ------------------------------- */
    [
      "p-som",
      ["Program", "view"],
      async () => {
        const cohorts = await prisma.cohort.findMany({
          where: { status: "Ongoing", program: { completed: false, ...branchWhere(ctx) } },
          orderBy: [{ startDate: "desc" }, { id: "desc" }],
          take: 4,
          select: { id: true, name: true },
        });
        const books = await Promise.all(
          cohorts.map((c) => assessmentService.getGradebook(c.id, null).catch(() => null)),
        );
        const out: { name: string; on_track: number; total: number }[] = [];
        cohorts.forEach((c, i) => {
          const book = books[i];
          if (!book || !book.rows.length) return;
          out.push({ name: c.name, on_track: book.rows.length - book.totals.atRisk, total: book.rows.length });
        });
        return { cohorts: out };
      },
    ],

    /* ------------------------------ p-today ----------------------------- */
    [
      "p-today",
      null,
      async () => {
        const today = dayStart(new Date());
        const rows = await prisma.appointment.findMany({
          where: {
            userId: ctx.userId,
            date: { gte: today, lt: addDays(today, 1) },
            status: { in: ["PENDING", "CONFIRMED", "RESCHEDULED"] },
          },
          orderBy: [{ startTime: "asc" }, { id: "asc" }],
          take: 10,
          select: { id: true, fullName: true, purpose: true, date: true, startTime: true, endTime: true, status: true },
        });
        const items: AgendaItem[] = rows.map((a) => ({
          date: withClock(a.date, a.startTime).toISOString(),
          title: a.purpose,
          sub: `${a.fullName} · ${a.startTime}${a.endTime ? `–${a.endTime}` : ""}`,
          pill:
            a.status === "CONFIRMED"
              ? { tone: "success", label: "Confirmed" }
              : a.status === "RESCHEDULED"
                ? { tone: "info", label: "New time suggested" }
                : { tone: "warning", label: "Not confirmed" },
          ref_id: a.id,
        }));
        return { items };
      },
    ],

    /* ----------------------------- p-events ----------------------------- */
    ["p-events", ["Events", "view"], () => upcomingEvents(ctx)],
  ]);

  const needs: NeedsItem[] = [];
  if ("p-sign" in widgets) {
    const [req, rep, appt] = await Promise.all([
      requisitions().catch(() => ({ total: 0 })),
      reports().catch(() => ({ total: 0 })),
      appointments().catch(() => ({ total: 0 })),
    ]);
    needs.push(
      { key: "p-req", label: "Requisitions", count: req.total, widget: "p-sign", tab: "requisition" },
      { key: "p-rep", label: "Department reports", count: rep.total, widget: "p-sign", tab: "dept_report" },
      { key: "p-appt", label: "Appointment requests", count: appt.total, widget: "p-sign", tab: "appointment" },
    );
  }

  return { needs, widgets };
};

/* -------------------------------------------------------------------------- */
/*                                 Helpers                                    */
/* -------------------------------------------------------------------------- */

/** A stored day plus an "HH:MM" clock (UTC, the church runs on GMT). */
const withClock = (day: Date, clock: string | null | undefined) => {
  const d = dayStart(day);
  const m = String(clock || "").match(/^(\d{1,2}):(\d{2})/);
  if (m) d.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
};

const mondayOf = (d: Date) => addDays(dayStart(d), -((d.getUTCDay() + 6) % 7));

type BranchValue = { branch_id: number; branch_name: string; value: number };

/**
 * Headcounts for the last 12 weeks (Mon–Sun), every recorded event combined,
 * or the last 12 occurrences of one scheduled event with `?att_event=<event_act id>`.
 * Totals are adults + youth + children + visitors + visiting clergy, as in
 * the church attendance report.
 */
const attendanceTrend = async (ctx: WorkspaceContext) => {
  const now = new Date();
  const lastWeek = mondayOf(now);
  const firstWeek = addDays(lastWeek, -7 * (ATT_WEEKS - 1));
  const eventId = Number(ctx.query.att_event);
  const selected = Number.isInteger(eventId) && eventId > 0 ? eventId : null;
  // An event can repeat less often than weekly; look back further for its last 12.
  const from = selected ? addDays(firstWeek, -7 * ATT_WEEKS * 3) : firstWeek;

  const rows = await prisma.event_attendance_summary.findMany({
    where: {
      date: { gte: from, lt: addDays(dayStart(now), 1) },
      ...(getRelationBranchScopedWhere(ctx.branchId, "event") ?? {}),
    },
    select: {
      event_mgt_id: true,
      date: true,
      adultMale: true,
      adultFemale: true,
      youthMale: true,
      youthFemale: true,
      childrenMale: true,
      childrenFemale: true,
      event: { select: { branch_id: true, event_name_id: true, event: { select: { event_name: true } } } },
    },
  });
  const counts = await buildAttendanceVisitorCountsMap(rows.map((r) => ({ eventId: r.event_mgt_id, date: r.date })));
  const heads = rows.map((r) => {
    const v = getAttendanceVisitorCountsForRecord(counts, r.event_mgt_id, r.date);
    return {
      day: dayStart(r.date),
      branchId: r.event.branch_id,
      nameId: r.event.event_name_id,
      name: r.event.event?.event_name || "Event",
      total:
        (r.adultMale || 0) + (r.adultFemale || 0) + (r.youthMale || 0) + (r.youthFemale || 0) +
        (r.childrenMale || 0) + (r.childrenFemale || 0) + v.visitors.total + v.visitorClergy.total,
    };
  });

  // Scheduled events recorded in the 12-week window, most recorded first.
  const seen = new Map<number, { id: number; name: string; n: number }>();
  heads
    .filter((h) => h.day >= firstWeek)
    .forEach((h) => {
      const e = seen.get(h.nameId) || { id: h.nameId, name: h.name, n: 0 };
      e.n += 1;
      seen.set(h.nameId, e);
    });
  const events = Array.from(seen.values())
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));

  const branches = ctx.branchId ? [] : await visibleBranches();
  const byBranch = (items: typeof heads): BranchValue[] | undefined =>
    branches.length > 1
      ? branches.map((b) => ({
          branch_id: b.id,
          branch_name: b.name,
          value: items.filter((h) => h.branchId === b.id).reduce((s, h) => s + h.total, 0),
        }))
      : undefined;
  const point = (label: string, items: typeof heads) => {
    const bb = byBranch(items);
    return { label, total: items.reduce((s, h) => s + h.total, 0), ...(bb ? { by_branch: bb } : {}) };
  };

  const points = selected
    ? Array.from(new Set(heads.filter((h) => h.nameId === selected).map((h) => h.day.getTime())))
        .sort((a, b) => a - b)
        .slice(-ATT_WEEKS)
        .map((t) => point(shortDate(new Date(t)), heads.filter((h) => h.nameId === selected && h.day.getTime() === t)))
    : Array.from({ length: ATT_WEEKS }, (_, i) => {
        const wFrom = addDays(firstWeek, 7 * i);
        const wTo = addDays(wFrom, 7);
        return point(shortDate(wFrom), heads.filter((h) => h.day >= wFrom && h.day < wTo));
      });
  return { events, points };
};

/**
 * Life centers in scope for the range. Definitions follow the life centers
 * report: leader = a member holding the leader role; attendance = attendee
 * rows per meeting; a soul "became a member" when soul_won.memberId is set or
 * a user lists it as their source soul; "no meeting in 2+ weeks" = more than
 * 14 days since the last meeting (or since the center was created).
 */
const lifeCenterHealth = async (ctx: WorkspaceContext) => {
  const { from, to } = ctx.range;
  const now = new Date();
  const centers = await prisma.life_center.findMany({
    where: branchWhere(ctx),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      life_center_member: { select: { role: { select: { name: true } } } },
    },
  });
  const ids = centers.map((c) => c.id);
  const [meetings, souls, lastMet] = ids.length
    ? await Promise.all([
        prisma.life_center_meeting.findMany({
          where: { lifeCenterId: { in: ids }, date: { gte: from, lte: to } },
          select: { lifeCenterId: true, _count: { select: { attendees: true } } },
        }),
        prisma.soul_won.findMany({
          where: { lifeCenterId: { in: ids }, date_won: { gte: from, lte: to } },
          select: { lifeCenterId: true, memberId: true, _count: { select: { converted_members: true } } },
        }),
        prisma.life_center_meeting.groupBy({
          by: ["lifeCenterId"],
          where: { lifeCenterId: { in: ids }, date: { lte: now } },
          _max: { date: true },
        }),
      ])
    : [[], [], []];
  const last = new Map(lastMet.map((r) => [r.lifeCenterId, r._max.date]));
  const met = new Set(meetings.map((m) => m.lifeCenterId));
  const people = meetings.reduce((s, m) => s + m._count.attendees, 0);

  const withoutLeader = centers.filter((c) => !c.life_center_member.some((m) => isLeaderRoleName(m.role?.name)));
  const stale = centers.filter((c) => {
    const since = last.get(c.id) ?? c.createdAt;
    return now.getTime() - dayStart(since).getTime() > 14 * DAY_MS;
  });

  const per = new Map<number, { souls: number; meetings: number; people: number }>();
  const entry = (id: number) => {
    const e = per.get(id) || { souls: 0, meetings: 0, people: 0 };
    per.set(id, e);
    return e;
  };
  meetings.forEach((m) => {
    const e = entry(m.lifeCenterId);
    e.meetings += 1;
    e.people += m._count.attendees;
  });
  souls.forEach((s) => {
    entry(s.lifeCenterId).souls += 1;
  });
  const top: BarRow[] = centers
    .map((c) => ({ c, e: per.get(c.id) }))
    .filter((x): x is { c: (typeof centers)[number]; e: { souls: number; meetings: number; people: number } } =>
      Boolean(x.e && x.e.souls > 0),
    )
    .sort((a, b) => b.e.souls - a.e.souls || a.c.name.localeCompare(b.c.name))
    .slice(0, 5)
    .map(({ c, e }) => ({
      label: c.name,
      value: e.souls,
      max: null,
      sub: e.meetings ? `${nf(round1(e.people / e.meetings))} avg attendance` : "No meetings recorded",
    }));

  return {
    stats: {
      souls_won: souls.length,
      became_members: souls.filter((s) => s.memberId || s._count.converted_members > 0).length,
      active_centers: met.size,
      total_centers: centers.length,
      avg_attendance: meetings.length ? round1(people / meetings.length) : null,
      without_leader: { count: withoutLeader.length, names: withoutLeader.slice(0, 3).map((c) => c.name) },
      no_meeting_2w: { count: stale.length, names: stale.slice(0, 3).map((c) => c.name) },
    },
    top,
  };
};

/** Confirmed (or untyped) events in the next 14 days with registration fill. */
const upcomingEvents = async (ctx: WorkspaceContext) => {
  const today = dayStart(new Date());
  const rows = await prisma.event_mgt.findMany({
    where: {
      ...branchWhere(ctx),
      start_date: { gte: today, lt: addDays(today, 15) },
      OR: [{ event_status: "CONFIRMED" }, { event_status: null }],
    },
    orderBy: [{ start_date: "asc" }, { id: "asc" }],
    take: LIST_LIMIT,
    select: {
      id: true,
      start_date: true,
      end_date: true,
      start_time: true,
      location: true,
      requires_registration: true,
      registration_capacity: true,
      event: { select: { event_name: true } },
      _count: { select: { event_registers: true } },
    },
  });
  const items: AgendaItem[] = rows.map((e) => {
    const start = e.start_date as Date;
    const days =
      e.end_date && e.end_date > start
        ? Math.round((dayStart(e.end_date).getTime() - dayStart(start).getTime()) / DAY_MS) + 1
        : 1;
    const when = days > 1 ? `${days} days` : e.start_time || dayLabel(start);
    const registered = e._count.event_registers;
    const cap = e.registration_capacity;
    let sub = `${when}${e.location ? ` · ${e.location}` : ""}`;
    let pill: Pill | null = null;
    if (e.requires_registration) {
      sub = cap ? `${when} · ${nf(registered)} of ${nf(cap)} registered` : `${when} · ${nf(registered)} registered`;
      if (cap) {
        const pct = Math.round((registered / cap) * 100);
        pill = pct >= 100 ? { tone: "success", label: "Full" } : { tone: pct < 50 ? "warning" : "info", label: `${pct}% full` };
      }
    }
    return {
      date: withClock(start, e.start_time).toISOString(),
      title: e.event?.event_name || "Event",
      sub,
      pill,
      ref_id: e.id,
    };
  });
  return { items };
};
