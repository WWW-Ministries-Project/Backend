/**
 * Church attendance report.
 *
 * Sources
 * - Headcounts: `event_attendance_summary` (one row per event occurrence and
 *   day). Visitors and visiting clergy come from linked `visit` records, the
 *   same way the church attendance endpoints and event reports count them, and
 *   a service's total is adults + youth + children + visitors.
 * - Worker attendance: `event_attendance` clock-ins (biometric import or
 *   check-in) of department members at SERVICE events, classified early /
 *   on time / late with the attendance timing rules from settings. Members
 *   hidden from event reports are left out, as in event reports.
 *
 * "Sunday" means a headcount dated on a Sunday (UTC) for a SERVICE event (or
 * an event with no type). Only services where at least one worker clocked in
 * count towards worker attendance, so services without clock-in data do not
 * read as 0%. Department rosters are today's rosters.
 *
 * Dropped from the design
 * - "Very late" punctuality band: the timing rules define early, on time and
 *   late only.
 * - Department "assigned services": there is no rota, so a department is
 *   expected at every service of its branch where clock-ins were taken.
 */
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere, getRelationBranchScopedWhere } from "../../branches/branchService";
import {
  buildAttendanceVisitorCountsMap,
  getAttendanceVisitorCountsForRecord,
} from "../../events/attendanceVisitorCounts";
import {
  AttendanceTimingStatus,
  classifyAttendanceTiming,
  loadAttendanceTimingResolver,
} from "../../settings/attendanceTimingSettingsService";
import { getEventReportExcludedUserIds } from "../../settings/eventReportExclusionService";
import { addDays, isoDate, shortDate } from "../period";
import {
  AM,
  BL,
  BZ,
  GN,
  GR,
  MG,
  NV,
  RD,
  SF,
  bars,
  byBranch,
  changeWords,
  flag,
  healthOf,
  heat,
  hbars,
  inRange,
  kpi,
  nf,
  pctCell,
  pctOf,
  pctPill,
  round1,
  segments,
  sortFlags,
  stats,
  sum,
  table,
} from "../sections";
import { Bucket, FlagDTO, ReportBuilder, SectionDTO } from "../types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ATTENDANCE_PATH = "/home/church-attendance";
const ANALYTICS_PATH = "/home/church-attendance/analytics";
const departmentPath = (id: number) => `/home/membership/departments-and-ministries/${id}`;

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const dayLabel = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${shortDate(d)}`;

type Headcount = {
  eventId: number;
  day: Date;
  branchId: number | null;
  nameId: number;
  name: string;
  isService: boolean;
  adultM: number;
  adultF: number;
  youthM: number;
  youthF: number;
  childM: number;
  childF: number;
  visitors: number;
  clergy: number;
  total: number;
};

type Occurrence = {
  eventId: number;
  day: Date;
  branchId: number | null;
  arrivals: { userId: number; status: AttendanceTimingStatus }[];
};

type Window = { from: Date; to: Date };

const adultsOf = (h: Headcount) => h.adultM + h.adultF;
const youthOf = (h: Headcount) => h.youthM + h.youthF;
const childrenOf = (h: Headcount) => h.childM + h.childF;

/** Start of the event on its occurrence day ("HH:MM" start_time, else start_date's clock). */
const eventStart = (day: Date, startTime: string | null, startDate: Date | null): Date | null => {
  const start = new Date(day.getTime());
  const match = String(startTime || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    start.setUTCHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
    return start;
  }
  if (!startDate) return null;
  start.setUTCHours(startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds(), 0);
  return start;
};

const weeksEndingAt = (last: Bucket, count: number): Bucket[] => {
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const from = addDays(last.from, -7 * i);
    out.push({ label: shortDate(from), from, to: addDays(from, 7) });
  }
  return out;
};

export const buildAttendance: ReportBuilder = async (ctx) => {
  /* ---------- Windows ---------- */
  // The Sunday chart ends with the week (Mon–Sun) of the last Sunday inside the
  // period and not after today, so a Sunday after the period never leaks in.
  const lastWeek: Bucket = (() => {
    const lastDay = addDays(new Date(Math.min(ctx.to.getTime(), addDays(dayStart(ctx.now), 1).getTime())), -1);
    const lastSunday = addDays(dayStart(lastDay), -lastDay.getUTCDay());
    const from = addDays(lastSunday, -6);
    return { label: shortDate(from), from, to: addDays(from, 7) };
  })();
  const chartWeeks = weeksEndingAt(lastWeek, Math.max(13, Math.min(26, ctx.weeks.length)));
  const flagWeeks = ctx.weeks.length >= 3 ? ctx.weeks : chartWeeks.slice(-3);

  const rangeFrom = new Date(
    Math.min(
      ctx.from.getTime(),
      ctx.prev.from.getTime(),
      ctx.yoy.from.getTime(),
      ctx.trend[0]?.from.getTime() ?? ctx.from.getTime(),
      chartWeeks[0].from.getTime(),
    ),
  );
  const rangeTo = new Date(Math.max(ctx.to.getTime(), lastWeek.to.getTime()));
  const today = dayStart(ctx.now);
  const missingTo = new Date(Math.min(ctx.to.getTime(), today.getTime()));

  const branchWhere = getBranchScopedWhere(ctx.branchId) || {};
  const serviceTypeWhere = { OR: [{ event_type: "SERVICE" as const }, { event_type: null }] };

  /* ---------- Queries ---------- */
  const [summaryRows, departments, excludedUserIds, resolveTiming, scheduledServices] = await Promise.all([
    prisma.event_attendance_summary.findMany({
      where: {
        date: { gte: rangeFrom, lt: rangeTo },
        ...(getRelationBranchScopedWhere(ctx.branchId, "event") || {}),
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
        event: {
          select: {
            branch_id: true,
            event_type: true,
            event_name_id: true,
            event: { select: { event_name: true } },
          },
        },
      },
    }),
    prisma.department.findMany({
      where: branchWhere,
      select: { id: true, name: true, branch_id: true },
      orderBy: { name: "asc" },
    }),
    getEventReportExcludedUserIds(),
    loadAttendanceTimingResolver(),
    missingTo > ctx.from
      ? prisma.event_mgt.findMany({
          where: {
            ...branchWhere,
            event_type: "SERVICE",
            start_date: { gte: ctx.from, lt: missingTo },
          },
          select: { id: true, start_date: true, event: { select: { event_name: true } } },
          orderBy: { start_date: "asc" },
        })
      : Promise.resolve([] as { id: number; start_date: Date | null; event: { event_name: string | null } }[]),
  ]);

  const deptIds = departments.map((d) => d.id);
  const deptIdSet = new Set(deptIds);

  const [visitorCounts, workerUsers] = await Promise.all([
    buildAttendanceVisitorCountsMap(summaryRows.map((r) => ({ eventId: r.event_mgt_id, date: r.date }))),
    deptIds.length
      ? prisma.user.findMany({
          where: {
            ...(excludedUserIds.size ? { id: { notIn: Array.from(excludedUserIds) } } : {}),
            OR: [
              { department_id: { in: deptIds } },
              { department: { department_id: { in: deptIds } } },
              { department_positions: { some: { department_id: { in: deptIds } } } },
            ],
          },
          select: {
            id: true,
            department_id: true,
            department: { select: { department_id: true } },
            department_positions: { select: { department_id: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  /* ---------- Rosters ---------- */
  const deptMembers = new Map<number, Set<number>>();
  for (const u of workerUsers) {
    const ids = new Set<number>();
    if (u.department?.department_id != null && deptIdSet.has(u.department.department_id)) ids.add(u.department.department_id);
    if (u.department_id != null && deptIdSet.has(u.department_id)) ids.add(u.department_id);
    for (const p of u.department_positions) if (deptIdSet.has(p.department_id)) ids.add(p.department_id);
    for (const id of ids) {
      const set = deptMembers.get(id) || new Set<number>();
      set.add(u.id);
      deptMembers.set(id, set);
    }
  }
  const workerIds = Array.from(new Set(Array.from(deptMembers.values()).flatMap((s) => Array.from(s))));

  const deptApplies = (deptBranch: number | null, eventBranch: number | null) =>
    deptBranch == null || eventBranch == null || deptBranch === eventBranch;
  const rosterCache = new Map<string, Set<number>>();
  const rosterFor = (eventBranch: number | null) => {
    const key = String(eventBranch);
    const cached = rosterCache.get(key);
    if (cached) return cached;
    const set = new Set<number>();
    for (const d of departments) {
      if (!deptApplies(d.branch_id, eventBranch)) continue;
      for (const id of deptMembers.get(d.id) || []) set.add(id);
    }
    rosterCache.set(key, set);
    return set;
  };

  /* ---------- Worker clock-ins ---------- */
  const firstArrivals = workerIds.length
    ? await prisma.event_attendance.groupBy({
        by: ["event_id", "user_id"],
        where: {
          user_id: { in: workerIds },
          created_at: { gte: rangeFrom, lt: rangeTo },
          event: { is: { ...branchWhere, ...serviceTypeWhere } },
        },
        _min: { created_at: true },
      })
    : [];
  const arrivalEventIds = Array.from(new Set(firstArrivals.map((r) => r.event_id)));
  const arrivalEvents = arrivalEventIds.length
    ? await prisma.event_mgt.findMany({
        where: { id: { in: arrivalEventIds } },
        select: { id: true, branch_id: true, start_date: true, start_time: true },
      })
    : [];
  const eventById = new Map(arrivalEvents.map((e) => [e.id, e]));

  const occurrenceMap = new Map<number, Occurrence>();
  for (const row of firstArrivals) {
    const arrival = row._min.created_at;
    const event = eventById.get(row.event_id);
    if (!arrival || !event) continue;
    const day = dayStart(event.start_date || arrival);
    let occ = occurrenceMap.get(row.event_id);
    if (!occ) {
      occ = { eventId: row.event_id, day, branchId: event.branch_id, arrivals: [] };
      occurrenceMap.set(row.event_id, occ);
    }
    const start = eventStart(day, event.start_time, event.start_date);
    const status: AttendanceTimingStatus = start
      ? classifyAttendanceTiming(Math.round((arrival.getTime() - start.getTime()) / 60000), resolveTiming(arrival))
      : "on_time";
    occ.arrivals.push({ userId: row.user_id, status });
  }
  const occurrences = Array.from(occurrenceMap.values());

  /* ---------- Headcounts ---------- */
  const headcounts: Headcount[] = summaryRows.map((r) => {
    const counts = getAttendanceVisitorCountsForRecord(visitorCounts, r.event_mgt_id, r.date);
    const h: Headcount = {
      eventId: r.event_mgt_id,
      day: dayStart(r.date),
      branchId: r.event.branch_id,
      nameId: r.event.event_name_id,
      name: r.event.event?.event_name || "Service",
      isService: r.event.event_type === "SERVICE" || r.event.event_type == null,
      adultM: r.adultMale || 0,
      adultF: r.adultFemale || 0,
      youthM: r.youthMale || 0,
      youthF: r.youthFemale || 0,
      childM: r.childrenMale || 0,
      childF: r.childrenFemale || 0,
      visitors: counts.visitors.total,
      clergy: counts.visitorClergy.total,
      total: 0,
    };
    h.total = adultsOf(h) + youthOf(h) + childrenOf(h) + h.visitors + h.clergy;
    return h;
  });
  const isSunday = (h: Headcount) => h.isService && h.day.getUTCDay() === 0;

  /* ---------- Metric helpers ---------- */
  const within = <T extends { day: Date }>(items: T[], w: Window) => items.filter((i) => inRange(i.day, w.from, w.to));

  const byDay = (items: Headcount[]) => {
    const map = new Map<string, { day: Date; total: number; services: number; adults: number; youth: number; children: number; visitors: number }>();
    for (const h of items) {
      const key = isoDate(h.day);
      const entry = map.get(key) || { day: h.day, total: 0, services: 0, adults: 0, youth: 0, children: 0, visitors: 0 };
      entry.total += h.total;
      entry.services += 1;
      entry.adults += adultsOf(h);
      entry.youth += youthOf(h);
      entry.children += childrenOf(h);
      entry.visitors += h.visitors + h.clergy;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.day.getTime() - b.day.getTime());
  };

  const sundayStats = (items: Headcount[], w: Window) => {
    const days = byDay(within(items, w).filter(isSunday));
    if (!days.length) return null;
    const n = days.length;
    return {
      avg: Math.round(sum(days.map((d) => d.total)) / n),
      youth: Math.round(sum(days.map((d) => d.youth)) / n),
      children: Math.round(sum(days.map((d) => d.children)) / n),
      adults: Math.round(sum(days.map((d) => d.adults)) / n),
    };
  };
  const avgSunday = (items: Headcount[], w: Window) => sundayStats(items, w)?.avg ?? null;

  const peakDay = (items: Headcount[], w: Window) => {
    const days = byDay(within(items, w));
    if (!days.length) return null;
    return days.reduce((best, d) => (d.total > best.total ? d : best), days[0]);
  };

  const visitorsIn = (items: Headcount[], w: Window) => {
    const list = within(items, w);
    return list.length ? sum(list.map((h) => h.visitors + h.clergy)) : null;
  };

  const workerStats = (occs: Occurrence[], w: Window) => {
    let expected = 0;
    let present = 0;
    let early = 0;
    let onTime = 0;
    let late = 0;
    for (const o of within(occs, w)) {
      const roster = rosterFor(o.branchId);
      if (!roster.size) continue;
      expected += roster.size;
      for (const a of o.arrivals) {
        if (!roster.has(a.userId)) continue;
        present += 1;
        if (a.status === "early") early += 1;
        else if (a.status === "late") late += 1;
        else onTime += 1;
      }
    }
    return {
      expected,
      present,
      early,
      onTime,
      late,
      pct: expected > 0 ? round1(pctOf(present, expected)) : null,
      onTimePct: present > 0 ? round1(pctOf(early + onTime, present)) : null,
    };
  };

  const deptStats = (deptId: number, deptBranch: number | null, occs: Occurrence[], w: Window) => {
    const members = deptMembers.get(deptId);
    let expected = 0;
    let present = 0;
    let late = 0;
    let services = 0;
    if (!members || !members.size) return { expected, present, late, services, pct: null as number | null };
    for (const o of within(occs, w)) {
      if (!deptApplies(deptBranch, o.branchId)) continue;
      services += 1;
      expected += members.size;
      for (const a of o.arrivals) {
        if (!members.has(a.userId)) continue;
        present += 1;
        if (a.status === "late") late += 1;
      }
    }
    return { expected, present, late, services, pct: expected > 0 ? round1(pctOf(present, expected)) : null };
  };

  const period: Window = { from: ctx.from, to: ctx.to };
  const periodHeadcounts = within(headcounts, period);
  const periodOccurrences = within(occurrences, period);

  /* ---------- KPIs ---------- */
  const sunNow = sundayStats(headcounts, period);
  const sunPrev = sundayStats(headcounts, ctx.prev);
  const sunYoy = sundayStats(headcounts, ctx.yoy);
  const peakNow = peakDay(headcounts, period);
  const peakPrev = peakDay(headcounts, ctx.prev);
  const peakYoy = peakDay(headcounts, ctx.yoy);
  const visNow = visitorsIn(headcounts, period);
  const wNow = workerStats(occurrences, period);
  const wPrev = workerStats(occurrences, ctx.prev);
  const wYoy = workerStats(occurrences, ctx.yoy);

  const ageMix = (items: Headcount[]) => {
    const a = sum(items.map(adultsOf));
    const y = sum(items.map(youthOf));
    const c = sum(items.map(childrenOf));
    const t = a + y + c;
    if (!t) return null;
    const ap = Math.round((a / t) * 100);
    const yp = Math.round((y / t) * 100);
    return { a: ap, y: yp, c: 100 - ap - yp, youthShare: (y / t) * 100 };
  };
  const mixNow = ageMix(periodHeadcounts);
  const mixPrev = ageMix(within(headcounts, ctx.prev));
  let mixSub: string | null = null;
  if (mixNow && mixPrev) {
    const diff = Math.round(mixNow.youthShare - mixPrev.youthShare);
    mixSub = diff === 0 ? "Youth share level with " + ctx.prev.label : `Youth share ${diff > 0 ? "up" : "down"} ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"}`;
  }

  const peakSub = peakNow
    ? `${WEEKDAYS_LONG[peakNow.day.getUTCDay()]} ${shortDate(peakNow.day)}${peakNow.services > 1 ? `, ${peakNow.services} services` : ""}`
    : null;

  const kpis = [
    kpi("avg_sunday_attendance", "Average Sunday attendance", sunNow?.avg ?? null, {
      prev: sunPrev?.avg ?? null,
      yoy: sunYoy?.avg ?? null,
      spark: ctx.trend.map((b) => avgSunday(headcounts, b) ?? 0),
    }),
    kpi("peak_attendance", "Peak attendance", peakNow?.total ?? null, {
      prev: peakPrev?.total ?? null,
      yoy: peakYoy?.total ?? null,
      spark: ctx.trend.map((b) => peakDay(headcounts, b)?.total ?? 0),
      sub: peakSub,
    }),
    kpi("age_mix", "Adults · Youth · Children", null, {
      format: "raw",
      display: mixNow ? `${mixNow.a} · ${mixNow.y} · ${mixNow.c}%` : null,
      good: null,
      sub: mixSub,
    }),
    kpi("visitors_present", "Visitors present", visNow, {
      prev: visitorsIn(headcounts, ctx.prev),
      yoy: visitorsIn(headcounts, ctx.yoy),
      spark: ctx.trend.map((b) => visitorsIn(headcounts, b) ?? 0),
      sub: "Includes visiting clergy",
    }),
    kpi("worker_attendance", "Worker attendance", wNow.pct, {
      format: "pct",
      prev: wPrev.pct,
      yoy: wYoy.pct,
      spark: ctx.trend.map((b) => workerStats(occurrences, b).pct ?? 0),
      sub: wNow.expected ? "Department members at services with clock-ins" : null,
    }),
    kpi("workers_on_time", "Workers on time", wNow.onTimePct, {
      format: "pct",
      prev: wPrev.onTimePct,
      yoy: wYoy.onTimePct,
      spark: ctx.trend.map((b) => workerStats(occurrences, b).onTimePct ?? 0),
      sub: wNow.present ? "Early or on time, from clock-in" : null,
    }),
  ];

  /* ---------- Department weekly figures ---------- */
  const activeDepts = departments.filter((d) => (deptMembers.get(d.id)?.size || 0) > 0);
  const deptPeriod = activeDepts
    .map((d) => ({ dept: d, s: deptStats(d.id, d.branch_id, occurrences, period) }))
    .filter((r) => r.s.services > 0);

  /* ---------- Flags ---------- */
  const flags: FlagDTO[] = [];

  for (const d of activeDepts) {
    const weekly = flagWeeks.map((w) => deptStats(d.id, d.branch_id, occurrences, w).pct).filter((v): v is number => v != null);
    let run = 0;
    for (let i = weekly.length - 1; i >= 0 && weekly[i] < 60; i -= 1) run += 1;
    if (run >= 3) {
      flags.push(flag("act", `${d.name} has been below 60% attendance for ${run} weeks running`, `View ${d.name}`, departmentPath(d.id)));
    }
  }

  const recordedEventIds = new Set(periodHeadcounts.map((h) => h.eventId));
  const missing = scheduledServices.filter((e) => !recordedEventIds.has(e.id) && e.start_date);
  if (missing.length) {
    const first = missing[0];
    const name = first.event?.event_name || "a service";
    const rest = missing.length - 1;
    flags.push(
      flag(
        "act",
        `No headcount was recorded for ${name} on ${dayLabel(first.start_date as Date)}${rest > 0 ? ` and ${rest} other service${rest === 1 ? "" : "s"}` : ""}`,
        "Add the headcount",
        ATTENDANCE_PATH,
      ),
    );
  }

  const midweekFalls: string[] = [];
  const midweekBySeries = new Map<number, Headcount[]>();
  for (const h of headcounts) {
    if (!h.isService || h.day.getUTCDay() === 0 || h.day >= ctx.to) continue;
    const list = midweekBySeries.get(h.nameId) || [];
    list.push(h);
    midweekBySeries.set(h.nameId, list);
  }
  for (const list of midweekBySeries.values()) {
    const days = byDay(list);
    if (days.length < 4) continue;
    const last4 = days.slice(-4);
    if (!inRange(last4[3].day, ctx.from, ctx.to)) continue;
    if (last4[0].total > last4[1].total && last4[1].total > last4[2].total && last4[2].total > last4[3].total) {
      const name = list[0].name;
      flags.push(flag("watch", `${name} attendance has fallen 3 times in a row, to ${nf(last4[3].total)}`, "View attendance trend", ANALYTICS_PATH));
      midweekFalls.push(`${name} attendance has slipped each time since ${shortDate(last4[0].day)}, from ${nf(last4[0].total)} to ${nf(last4[3].total)}.`);
    }
  }

  const sortedFlags = sortFlags(flags);

  /* ---------- Sections ---------- */
  const sections: SectionDTO[] = [];

  const weekly = chartWeeks.map((w) => {
    const days = byDay(within(headcounts, w).filter(isSunday));
    return {
      label: shortDate(addDays(w.from, 6)),
      adults: sum(days.map((d) => d.adults)),
      youth: sum(days.map((d) => d.youth)),
      children: sum(days.map((d) => d.children)),
      visitors: sum(days.map((d) => d.visitors)),
      total: sum(days.map((d) => d.total)),
      has: days.length > 0,
    };
  });
  if (weekly.some((w) => w.has)) {
    const movingAvg = weekly.map((_, i) => {
      const win = weekly.slice(Math.max(0, i - 3), i + 1).filter((w) => w.has);
      return win.length ? Math.round(sum(win.map((w) => w.total)) / win.length) : 0;
    });
    sections.push(
      bars(
        "trend",
        "Attendance trend",
        "Sunday attendance by age group, with the 4-week average",
        weekly.map((w) => w.label),
        [
          { name: "Adults", color: NV, values: weekly.map((w) => w.adults) },
          { name: "Youth", color: BZ, values: weekly.map((w) => w.youth) },
          { name: "Children", color: SF, values: weekly.map((w) => w.children) },
          { name: "Visitors", color: GR, values: weekly.map((w) => w.visitors) },
        ],
        { full: true, stack: true, line: { name: "4-week average", color: BL, values: movingAvg } },
      ),
    );
  }

  const sundaysNow = within(headcounts, period).filter(isSunday);
  const compSource = sundaysNow.length ? sundaysNow : periodHeadcounts;
  if (compSource.length) {
    sections.push(
      segments(
        "composition",
        "Composition",
        sundaysNow.length ? `All Sunday attendance, ${ctx.periodLabel}` : `All recorded attendance, ${ctx.periodLabel}`,
        [
          {
            label: "Members, visitors and clergy",
            parts: [
              { label: "Members", value: sum(compSource.map((h) => adultsOf(h) + youthOf(h) + childrenOf(h))), color: NV },
              { label: "Visitors", value: sum(compSource.map((h) => h.visitors)), color: BZ },
              { label: "Visiting clergy", value: sum(compSource.map((h) => h.clergy)), color: SF },
            ],
          },
          {
            label: "Adults by gender",
            parts: [
              { label: "Female", value: sum(compSource.map((h) => h.adultF)), color: NV },
              { label: "Male", value: sum(compSource.map((h) => h.adultM)), color: BZ },
            ],
          },
          {
            label: "Youth by gender",
            parts: [
              { label: "Female", value: sum(compSource.map((h) => h.youthF)), color: NV },
              { label: "Male", value: sum(compSource.map((h) => h.youthM)), color: BZ },
            ],
          },
          {
            label: "Children by gender",
            parts: [
              { label: "Girls", value: sum(compSource.map((h) => h.childF)), color: NV },
              { label: "Boys", value: sum(compSource.map((h) => h.childM)), color: BZ },
            ],
          },
        ],
      ),
    );
  }

  const serviceGroups = new Map<number, { name: string; totals: number[]; weekdays: Set<number> }>();
  for (const h of periodHeadcounts) {
    const g = serviceGroups.get(h.nameId) || { name: h.name, totals: [], weekdays: new Set<number>() };
    g.totals.push(h.total);
    g.weekdays.add(h.day.getUTCDay());
    serviceGroups.set(h.nameId, g);
  }
  const serviceRows = Array.from(serviceGroups.values())
    .map((g) => ({
      label: g.name,
      value: Math.round(sum(g.totals) / g.totals.length),
      sub: `${Array.from(g.weekdays).sort().map((d) => WEEKDAYS_LONG[d]).join(", ")} · ${g.totals.length} recorded`,
    }))
    .sort((a, b) => b.value - a.value);
  if (serviceRows.length) {
    sections.push(
      hbars("services", "Service comparison", "Average attendance per service", serviceRows.slice(0, 10), {
        note: serviceRows.length > 10 ? `Top 10 of ${serviceRows.length} services` : undefined,
      }),
    );
  }

  if (deptPeriod.length) {
    const rows = deptPeriod
      .map(({ dept, s }) => {
        const members = deptMembers.get(dept.id)?.size || 0;
        const presentAvg = Math.round(s.present / s.services);
        const pct = s.pct ?? 0;
        return {
          cells: [
            { text: dept.name, bold: true },
            nf(members),
            nf(presentAvg),
            nf(Math.max(members - presentAvg, 0)),
            { pill: pctPill(pct) },
            nf(s.late),
          ],
          keys: [dept.name, members, presentAvg, Math.max(members - presentAvg, 0), pct, s.late],
        };
      })
      .sort((a, b) => Number(b.keys[4]) - Number(a.keys[4]));
    sections.push(
      table(
        "dept",
        "Department attendance",
        "Workers present at services with clock-ins, average per service. Click a column to sort.",
        [
          ["Department", "minmax(170px,1.4fr)"],
          ["Members", "90px", "right"],
          ["Present", "80px", "right"],
          ["Absent", "80px", "right"],
          ["Attendance", "110px", "right"],
          ["Late", "70px", "right"],
        ],
        rows,
        { full: true, sortable: true, minWidth: "640px" },
      ),
    );

    sections.push(
      heat(
        "dept-weeks",
        "Department attendance by week",
        "Green 75% or more · amber 60–74% · red below 60%",
        ctx.weeks.map((w) => w.label),
        deptPeriod
          .slice()
          .sort((a, b) => (b.s.pct ?? 0) - (a.s.pct ?? 0))
          .map(({ dept }) => ({
            label: dept.name,
            cells: ctx.weeks.map((w) => pctCell(deptStats(dept.id, dept.branch_id, occurrences, w).pct)),
          })),
        { full: true },
      ),
    );
  }

  if (wNow.present > 0) {
    const rules = resolveTiming(ctx.now);
    sections.push(
      segments("punctuality", "Punctuality", "Worker clock-in compared with service start", [
        {
          parts: [
            { label: `Early (${rules.early}+ min before)`, value: wNow.early, color: GN },
            { label: "On time", value: wNow.onTime, color: NV },
            { label: `Late (${rules.late}+ min after)`, value: wNow.late, color: AM },
          ],
        },
      ]),
    );
  }

  const yoyStat = (label: string, now: number | null, then: number | null, pct = false) => {
    const show = (v: number | null) => (v == null ? "—" : pct ? `${Math.round(v)}%` : nf(v));
    if (now == null || then == null) {
      return { label, value: show(now), sub: then == null ? `No data for ${ctx.yoy.label}` : "No data this period", color: MG };
    }
    if (pct) {
      const diff = Math.round(now - then);
      return {
        label,
        value: show(now),
        sub: diff === 0 ? `Level with ${show(then)}` : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} pts from ${show(then)}`,
        color: diff > 0 ? GN : diff < 0 ? RD : MG,
      };
    }
    if (then === 0) {
      return { label, value: show(now), sub: now === 0 ? "Level with 0" : "Up from 0", color: now > 0 ? GN : MG };
    }
    const change = Math.round(((now - then) / then) * 100);
    return {
      label,
      value: show(now),
      sub: change === 0 ? `Level with ${show(then)}` : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% from ${show(then)}`,
      color: change > 0 ? GN : change < 0 ? RD : MG,
    };
  };
  if (sunNow || sunYoy || wNow.pct != null || wYoy.pct != null) {
    sections.push(
      stats("yoy", "Year on year", `${ctx.periodLabel} against ${ctx.yoy.label}`, [
        yoyStat("Average Sunday attendance", sunNow?.avg ?? null, sunYoy?.avg ?? null),
        yoyStat("Youth average", sunNow?.youth ?? null, sunYoy?.youth ?? null),
        yoyStat("Children average", sunNow?.children ?? null, sunYoy?.children ?? null),
        yoyStat("Worker attendance", wNow.pct, wYoy.pct, true),
      ]),
    );
  }

  /* ---------- Highlights ---------- */
  const highlights: string[] = [];
  if (sunNow) {
    const prevWords = changeWords(sunNow.avg, sunPrev?.avg, ctx.prev.label);
    const yoyWords = changeWords(sunNow.avg, sunYoy?.avg, ctx.yoy.label);
    highlights.push(
      `Sunday attendance averaged ${nf(sunNow.avg)}${prevWords}${yoyWords ? (prevWords ? " and" : ",") + yoyWords.replace(/^,/, "") : ""}.`,
    );
  } else if (peakNow) {
    highlights.push(`No Sunday headcount was recorded; the busiest day was ${dayLabel(peakNow.day)} with ${nf(peakNow.total)}.`);
  }
  if (sunNow && sunPrev) {
    const groups = [
      { name: "Adult", now: sunNow.adults, prev: sunPrev.adults },
      { name: "Youth", now: sunNow.youth, prev: sunPrev.youth },
      { name: "Children's", now: sunNow.children, prev: sunPrev.children },
    ]
      .filter((g) => g.prev > 0)
      .map((g) => ({ ...g, change: Math.round(((g.now - g.prev) / g.prev) * 100) }))
      .sort((a, b) => b.change - a.change);
    if (groups.length && groups[0].change > 0) {
      highlights.push(`${groups[0].name} attendance grew fastest (+${groups[0].change}%) against ${ctx.prev.label}.`);
    }
  }
  if (wNow.onTimePct != null) {
    const diff = wPrev.onTimePct != null ? Math.round(wNow.onTimePct - wPrev.onTimePct) : null;
    highlights.push(
      `${Math.round(wNow.onTimePct)}% of worker clock-ins were early or on time${
        diff ? `, ${diff > 0 ? "up" : "down"} ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} on ${ctx.prev.label}` : ""
      }.`,
    );
  }
  if (midweekFalls.length) highlights.push(midweekFalls[0]);
  else if (serviceRows.length > 1) {
    highlights.push(`${serviceRows[0].label} drew the most people, averaging ${nf(serviceRows[0].value)} per service.`);
  }

  /* ---------- By branch ---------- */
  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "attendance",
      ["Avg Sunday", "Peak", "Worker attendance", "On time"],
      ctx.branches.map((b) => {
        const hs = headcounts.filter((h) => h.branchId === b.id);
        const os = occurrences.filter((o) => o.branchId === b.id);
        const avg = avgSunday(hs, period);
        const peak = peakDay(hs, period);
        const w = workerStats(os, period);
        return {
          branch: b.name,
          values: [
            avg == null ? "—" : nf(avg),
            peak ? nf(peak.total) : "—",
            w.pct == null ? "—" : `${Math.round(w.pct)}%`,
            w.onTimePct == null ? "—" : `${Math.round(w.onTimePct)}%`,
          ],
        };
      }),
    );
  }

  const empty = periodHeadcounts.length === 0 && periodOccurrences.length === 0;

  return {
    body: {
      kpis,
      flags: sortedFlags,
      highlights: highlights.slice(0, 4),
      sections,
      by_branch,
      headline: [0, 4],
      health: healthOf(sortedFlags),
      provisional_note: null,
      empty,
    },
    facts: {
      avg_sunday_attendance: sunNow?.avg ?? null,
      peak_attendance: peakNow?.total ?? null,
      worker_attendance_pct: wNow.pct,
    },
  };
};
