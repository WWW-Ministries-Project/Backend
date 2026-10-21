/**
 * Events report.
 *
 * Definitions (reusing events + eventReports):
 * - An event is one event_mgt row (each occurrence of a series is its own row),
 *   dated by start_date (UTC). "Held" = start_date in the period and before now.
 * - Type = event_mgt.event_type, falling back to the event name's type, else OTHER.
 * - Weekly vs special = event_act.event_category; when unset, an event that
 *   belongs to a recurrence series counts as weekly.
 * - Headcount = church attendance summary (adult + youth + children, all dates
 *   recorded for the event) + visits linked to the event — the same total the
 *   event report uses. With no summary, individual check-ins (event_attendance,
 *   incl. biometric imports) + visits. Neither = "no headcount recorded".
 * - Turn-up = attended / registered, only for events that require registration
 *   and have registrations and a headcount; attended is capped at registered.
 * - Capacity filled = headcount / registration_capacity (capped at 100%).
 * - Visitors = visit rows linked to the event.
 * - Income = event_report_finance.total_income on the event's report(s).
 *
 * Dropped / adapted from the design mock:
 * - "Offering" column shows income recorded on the event report (any status);
 *   there is no per-event offering field.
 * - "first-time visitors" and reasons in highlights (SMS reminders, rain) have
 *   no data source; highlights stick to measured figures.
 * - Day/time heatmap uses the event's start_time as entered; events without a
 *   start time are left out (noted on the section).
 */
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { addDays, isoDate, shortDate } from "../period";
import {
  BZ,
  GN,
  NV,
  SF,
  attCell,
  bars,
  byBranch,
  changeWords,
  flag,
  hbars,
  healthOf,
  heat,
  kpi,
  nf,
  ghs,
  pctOf,
  pctPill,
  round1,
  sortFlags,
  stats,
  sum,
  table,
} from "../sections";
import { FlagDTO, ReportBuilder, SectionDTO, TableCell } from "../types";

type EvType = "SERVICE" | "PROGRAM" | "ACTIVITY" | "OTHER";

const TYPEC: Record<EvType, string> = {
  SERVICE: "#FFD700",
  PROGRAM: "#00CFC1",
  ACTIVITY: "#FF6B4D",
  OTHER: "#C1BFFF",
};
const TYPEL: Record<EvType, string> = {
  SERVICE: "Service",
  PROGRAM: "Programme",
  ACTIVITY: "Activity",
  OTHER: "Other",
};
const TYPE_PLURAL: Record<EvType, [string, string]> = {
  SERVICE: ["service", "services"],
  PROGRAM: ["programme", "programmes"],
  ACTIVITY: ["activity", "activities"],
  OTHER: ["other", "other"],
};
const TYPES: EvType[] = ["SERVICE", "PROGRAM", "ACTIVITY", "OTHER"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOTS = ["Morning", "Afternoon", "Evening", "Night"];
const DAY_MS = 86_400_000;

const viewEventPath = (id: number) => `/home/events/events/view-event?event_id=${id}`;

interface Ev {
  id: number;
  name: string;
  type: EvType;
  weekly: boolean;
  date: Date;
  startTime: string | null;
  branchId: number | null;
  requiresReg: boolean;
  capacity: number | null;
  registered: number;
  headcount: number | null;
  visitors: number;
  income: number;
}

interface Metrics {
  held: number;
  registrations: number;
  turnup: number | null;
  noshow: number | null;
  capacity: number | null;
  visitors: number;
  attendance: number;
}

const turnupOf = (e: Ev) =>
  e.requiresReg && e.registered > 0 && e.headcount != null
    ? pctOf(Math.min(e.headcount, e.registered), e.registered)
    : null;

const capacityOf = (e: Ev) =>
  e.capacity && e.capacity > 0 && e.headcount != null
    ? pctOf(Math.min(e.headcount, e.capacity), e.capacity)
    : null;

const metrics = (evs: Ev[]): Metrics => {
  const reg = evs.filter((e) => turnupOf(e) != null);
  const regSum = sum(reg.map((e) => e.registered));
  const turnup = regSum > 0 ? pctOf(sum(reg.map((e) => Math.min(e.headcount as number, e.registered))), regSum) : null;
  const cap = evs.filter((e) => capacityOf(e) != null);
  const capSum = sum(cap.map((e) => e.capacity as number));
  return {
    held: evs.length,
    registrations: sum(evs.map((e) => e.registered)),
    turnup,
    noshow: turnup == null ? null : round1(100 - turnup),
    capacity: capSum > 0 ? pctOf(sum(cap.map((e) => Math.min(e.headcount as number, e.capacity as number))), capSum) : null,
    visitors: sum(evs.map((e) => e.visitors)),
    attendance: sum(evs.map((e) => e.headcount || 0)),
  };
};

/** Nulls in a spark carry the previous value forward. */
const fillSpark = (values: (number | null)[]) => {
  let last = 0;
  return values.map((v) => {
    if (v != null) last = v;
    return last;
  });
};

const slotOf = (startTime: string | null): number | null => {
  if (!startTime) return null;
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(startTime);
  if (!match) return null;
  let hour = Number(match[1]);
  const ampm = match[3]?.toLowerCase();
  if (ampm?.startsWith("p") && hour < 12) hour += 12;
  if (ampm?.startsWith("a") && hour === 12) hour = 0;
  if (hour > 23) return null;
  return hour < 12 ? 0 : hour < 17 ? 1 : hour < 20 ? 2 : 3;
};

const minDate = (...dates: Date[]) => new Date(Math.min(...dates.map((d) => d.getTime())));
const maxDate = (...dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())));

export const buildEvents: ReportBuilder = async (ctx) => {
  const span = ctx.to.getTime() - ctx.from.getTime();
  const nextTo = new Date(ctx.to.getTime() + span);
  const upFrom = maxDate(ctx.now, ctx.from);
  const dataFrom = minDate(ctx.from, ctx.prev.from, ctx.yoy.from, ...ctx.trend.map((b) => b.from));
  const dataTo = maxDate(ctx.to, nextTo, ...ctx.trend.map((b) => b.to));

  const eventWhere = {
    start_date: { gte: dataFrom, lt: dataTo },
    ...(getBranchScopedWhere(ctx.branchId) || {}),
  };

  const [rows, regs, checkins, summaries, visits, reports] = await Promise.all([
    prisma.event_mgt.findMany({
      where: eventWhere,
      select: {
        id: true,
        start_date: true,
        start_time: true,
        branch_id: true,
        event_type: true,
        requires_registration: true,
        registration_capacity: true,
        recurrence_series_id: true,
        event: { select: { event_name: true, event_type: true, event_category: true } },
      },
    }),
    prisma.event_registers.groupBy({
      by: ["event_id"],
      where: { event: { is: eventWhere } },
      _count: { _all: true },
    }),
    prisma.event_attendance.groupBy({
      by: ["event_id"],
      where: { event: { is: eventWhere } },
      _count: { _all: true },
    }),
    prisma.event_attendance_summary.groupBy({
      by: ["event_mgt_id"],
      where: { event: { is: eventWhere } },
      _sum: {
        adultMale: true,
        adultFemale: true,
        youthMale: true,
        youthFemale: true,
        childrenMale: true,
        childrenFemale: true,
      },
    }),
    prisma.visit.groupBy({
      by: ["eventId"],
      where: { event: { is: eventWhere } },
      _count: { _all: true },
    }),
    prisma.event_reports.findMany({
      where: { event: { is: eventWhere }, finance: { isNot: null } },
      select: { event_id: true, finance: { select: { total_income: true } } },
    }),
  ]);

  const regBy = new Map(regs.map((r) => [r.event_id, r._count._all]));
  const checkinBy = new Map(checkins.map((r) => [r.event_id, r._count._all]));
  const visitBy = new Map(visits.map((r) => [r.eventId as number, r._count._all]));
  const summaryBy = new Map(
    summaries.map((s) => [
      s.event_mgt_id,
      Number(s._sum.adultMale || 0) +
        Number(s._sum.adultFemale || 0) +
        Number(s._sum.youthMale || 0) +
        Number(s._sum.youthFemale || 0) +
        Number(s._sum.childrenMale || 0) +
        Number(s._sum.childrenFemale || 0),
    ]),
  );
  const incomeBy = new Map<number, number>();
  for (const r of reports) {
    incomeBy.set(r.event_id, (incomeBy.get(r.event_id) || 0) + Number(r.finance?.total_income || 0));
  }

  const all: Ev[] = rows
    .filter((r) => r.start_date)
    .map((r) => {
      const rawType = (r.event_type || r.event?.event_type || "OTHER") as EvType;
      const type: EvType = TYPES.includes(rawType) ? rawType : "OTHER";
      const category = r.event?.event_category;
      const visitorsCount = visitBy.get(r.id) || 0;
      const summary = summaryBy.get(r.id);
      const checkin = checkinBy.get(r.id) || 0;
      const headcount = summary != null ? summary + visitorsCount : checkin > 0 ? checkin + visitorsCount : null;
      return {
        id: r.id,
        name: (r.event?.event_name || "Untitled event").trim(),
        type,
        weekly: category ? category === "WEEKLY" : !!r.recurrence_series_id,
        date: r.start_date as Date,
        startTime: r.start_time || null,
        branchId: r.branch_id,
        requiresReg: r.requires_registration,
        capacity: r.registration_capacity,
        registered: regBy.get(r.id) || 0,
        headcount,
        visitors: visitorsCount,
        income: incomeBy.get(r.id) || 0,
      };
    });

  const heldIn = (from: Date, to: Date) => all.filter((e) => e.date >= from && e.date < to && e.date < ctx.now);
  const inPeriod = all.filter((e) => e.date >= ctx.from && e.date < ctx.to);
  const held = heldIn(ctx.from, ctx.to);
  const cur = metrics(held);
  const prev = metrics(heldIn(ctx.prev.from, ctx.prev.to));
  const yoy = metrics(heldIn(ctx.yoy.from, ctx.yoy.to));
  const trend = ctx.trend.map((b) => metrics(heldIn(b.from, b.to)));
  const yoyHasData = yoy.held > 0;
  const prevHasData = prev.held > 0;

  /* KPIs */
  const typeCounts = TYPES.map((t) => ({ t, n: held.filter((e) => e.type === t).length })).filter((x) => x.n > 0);
  const kpis = [
    kpi("events_held", "Events held", cur.held, {
      prev: prev.held,
      yoy: yoyHasData ? yoy.held : null,
      good: null,
      spark: trend.map((m) => m.held),
      sub: typeCounts.map((x) => `${x.n} ${TYPE_PLURAL[x.t][x.n === 1 ? 0 : 1]}`).join(" · ") || null,
    }),
    kpi("registrations", "Registrations", cur.registrations, {
      prev: prev.registrations,
      yoy: yoyHasData ? yoy.registrations : null,
      spark: trend.map((m) => m.registrations),
    }),
    kpi("turnup_rate", "Turn-up rate", cur.turnup, {
      format: "pct",
      prev: prev.turnup,
      yoy: yoy.turnup,
      spark: fillSpark(trend.map((m) => m.turnup)),
      sub: cur.turnup == null ? "No events took registrations" : "Events that took registrations",
    }),
    kpi("noshow_rate", "No-show rate", cur.noshow, {
      format: "pct",
      prev: prev.noshow,
      yoy: yoy.noshow,
      good: "down",
      spark: fillSpark(trend.map((m) => m.noshow)),
    }),
    kpi("capacity_filled", "Capacity filled", cur.capacity, {
      format: "pct",
      prev: prev.capacity,
      yoy: yoy.capacity,
      spark: fillSpark(trend.map((m) => m.capacity)),
      sub: cur.capacity == null ? "No events with a set capacity" : "Events with a set capacity",
    }),
    kpi("visitors", "Visitors attracted", cur.visitors, {
      prev: prev.visitors,
      yoy: yoyHasData ? yoy.visitors : null,
      spark: trend.map((m) => m.visitors),
    }),
  ];

  /* Upcoming events that take registrations */
  const upcoming = all
    .filter((e) => e.requiresReg && e.date >= upFrom && e.date < nextTo)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  /* Flags */
  const flags: FlagDTO[] = [];
  const lowTurnup = held
    .filter((e) => e.registered >= 10 && turnupOf(e) != null && (turnupOf(e) as number) < 60)
    .sort((a, b) => (turnupOf(a) as number) - (turnupOf(b) as number))
    .slice(0, 2);
  for (const e of lowTurnup) {
    flags.push(
      flag(
        "act",
        `${e.name} (${shortDate(e.date)}) had a ${Math.round(turnupOf(e) as number)}% turn-up rate (${nf(Math.min(e.headcount as number, e.registered))} of ${nf(e.registered)} registered)`,
        "View event",
        viewEventPath(e.id),
      ),
    );
  }
  const nearCap = held
    .filter((e) => (capacityOf(e) ?? 0) >= 90)
    .sort((a, b) => (capacityOf(b) as number) - (capacityOf(a) as number))
    .slice(0, 2);
  for (const e of nearCap) {
    flags.push(
      flag(
        "watch",
        `${e.name} filled ${Math.round(capacityOf(e) as number)}% of capacity. Plan overflow seating for its next run.`,
        "View event",
        viewEventPath(e.id),
      ),
    );
  }
  const underReg = upcoming
    .filter((e) => {
      if (!e.capacity || e.capacity <= 0) return false;
      const weeksOut = (e.date.getTime() - ctx.now.getTime()) / (7 * DAY_MS);
      return weeksOut <= 6 && pctOf(e.registered, e.capacity) < 50;
    })
    .slice(0, 2);
  for (const e of underReg) {
    const weeks = Math.max(0, Math.round((e.date.getTime() - ctx.now.getTime()) / (7 * DAY_MS)));
    const when = weeks === 0 ? "this week" : weeks === 1 ? "1 week out" : `${weeks} weeks out`;
    flags.push(
      flag(
        weeks <= 1 && pctOf(e.registered, e.capacity as number) < 25 ? "act" : "watch",
        `${e.name} has ${nf(e.registered)} of ${nf(e.capacity)} places registered, ${when}`,
        "View event",
        viewEventPath(e.id),
      ),
    );
  }
  const noCount = held.filter((e) => e.headcount == null);
  if (noCount.length > 0) {
    flags.push(
      flag(
        "watch",
        `${noCount.length} ${noCount.length === 1 ? "event has" : "events have"} no headcount recorded, so ${noCount.length === 1 ? "it is" : "they are"} left out of attendance figures`,
        "Record attendance",
        "/home/church-attendance",
      ),
    );
  }
  const sortedFlags = sortFlags(flags);

  /* Highlights */
  const highlights: string[] = [];
  if (cur.held > 0) {
    let line = `${nf(cur.held)} ${cur.held === 1 ? "event" : "events"} ran in ${ctx.periodLabel}${changeWords(cur.held, prevHasData ? prev.held : null, ctx.prev.label)}.`;
    if (cur.attendance > 0) {
      const top = TYPES.map((t) => ({ t, a: sum(held.filter((e) => e.type === t).map((e) => e.headcount || 0)) })).sort((a, b) => b.a - a.a)[0];
      line += ` ${TYPE_PLURAL[top.t][1].replace(/^./, (c) => c.toUpperCase())} drew ${Math.round(pctOf(top.a, cur.attendance))}% of all attendance.`;
    }
    highlights.push(line);
  }
  if (cur.turnup != null) {
    const diff = prev.turnup != null ? Math.round(cur.turnup - prev.turnup) : null;
    highlights.push(
      `Turn-up was ${Math.round(cur.turnup)}%` +
        (diff == null ? "." : diff === 0 ? `, level with ${ctx.prev.label}.` : `, ${diff > 0 ? "up" : "down"} ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "point" : "points"} on ${ctx.prev.label}.`),
    );
  }
  const topVisitors = held.slice().sort((a, b) => b.visitors - a.visitors)[0];
  if (topVisitors && topVisitors.visitors > 0) {
    highlights.push(
      `${topVisitors.name} (${shortDate(topVisitors.date)}) brought ${nf(topVisitors.visitors)} ${topVisitors.visitors === 1 ? "visitor" : "visitors"}, more than any other event.`,
    );
  }
  const lowest = held
    .filter((e) => turnupOf(e) != null && e.registered >= 5)
    .sort((a, b) => (turnupOf(a) as number) - (turnupOf(b) as number))[0];
  if (lowest && (turnupOf(lowest) as number) < 75 && highlights.length < 4) {
    highlights.push(
      `${lowest.name} had the lowest turn-up: only ${Math.round(turnupOf(lowest) as number)}% of its ${nf(lowest.registered)} registrations came.`,
    );
  }

  /* Sections */
  const sections: SectionDTO[] = [];

  // Calendar
  const periodDays = Math.round(span / DAY_MS);
  if (periodDays <= 62 && inPeriod.length > 0) {
    const byDay = new Map<string, Ev[]>();
    for (const e of inPeriod) {
      const key = isoDate(e.date);
      byDay.set(key, [...(byDay.get(key) || []), e]);
    }
    const days: Extract<SectionDTO, { kind: "calendar" }>["days"] = [];
    for (let d = ctx.from; d < ctx.to; d = addDays(d, 1)) {
      const key = isoDate(d);
      const evs = (byDay.get(key) || []).sort((a, b) => a.date.getTime() - b.date.getTime());
      const dow = DOW[d.getUTCDay()];
      days.push({
        key,
        dow,
        day: d.getUTCDate(),
        weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 || undefined,
        colors: evs.map((e) => TYPEC[e.type]),
        tip:
          `${dow} ${shortDate(d)}` +
          (evs.length
            ? " · " +
              evs
                .map(
                  (e) =>
                    `${e.name}: ${e.date >= ctx.now ? "scheduled" : e.headcount == null ? "no headcount recorded" : `${nf(e.headcount)} attended`}`,
                )
                .join(" · ")
            : " · no events"),
      });
    }
    const usedTypes = TYPES.filter((t) => inPeriod.some((e) => e.type === t));
    sections.push({
      kind: "calendar",
      id: "calendar",
      title: "Calendar",
      sub: `Every event in ${ctx.periodLabel}, coloured by type. Hover a day for attendance.`,
      full: true,
      legend: usedTypes.map((t) => ({ label: TYPEL[t], color: TYPEC[t] })),
      days,
    });
  }

  // Leaderboard
  if (held.length > 0) {
    const ranked = held.slice().sort((a, b) => (b.headcount ?? -1) - (a.headcount ?? -1) || a.date.getTime() - b.date.getTime());
    const LIMIT = 50;
    const lbRows = ranked.slice(0, LIMIT).map((e) => {
      const t = turnupOf(e);
      const turnCell: TableCell = t == null ? "—" : t < 60 ? { pill: pctPill(t) } : `${Math.round(t)}%`;
      return {
        cells: [
          { text: e.name, bold: true },
          shortDate(e.date),
          TYPEL[e.type],
          e.requiresReg || e.registered > 0 ? nf(e.registered) : "—",
          e.headcount == null ? "—" : nf(e.headcount),
          turnCell,
          nf(e.visitors),
          e.income > 0 ? ghs(e.income) : "—",
        ] as TableCell[],
        keys: [e.name, e.date.getTime(), TYPEL[e.type], e.registered, e.headcount ?? -1, t ?? -1, e.visitors, e.income],
      };
    });
    sections.push(
      table(
        "lb",
        "Event leaderboard",
        "Click a column to sort",
        [
          ["Event", "minmax(200px,1.6fr)"],
          ["Date", "90px"],
          ["Type", "100px"],
          ["Registered", "100px", "right"],
          ["Attended", "90px", "right"],
          ["Turn-up", "80px", "right"],
          ["Visitors", "80px", "right"],
          ["Income", "120px", "right"],
        ],
        lbRows,
        {
          full: true,
          sortable: true,
          minWidth: "960px",
          note:
            (ranked.length > LIMIT ? `Top ${LIMIT} of ${nf(ranked.length)} events by attendance. ` : "") +
            "Income is the total recorded on the event's report.",
        },
      ),
    );
  }

  // Registered vs attended
  const regHeld = held
    .filter((e) => turnupOf(e) != null)
    .sort((a, b) => b.registered - a.registered)
    .slice(0, 10);
  if (regHeld.length > 0) {
    const nameCount = new Map<string, number>();
    regHeld.forEach((e) => nameCount.set(e.name, (nameCount.get(e.name) || 0) + 1));
    sections.push(
      bars(
        "reg-vs-att",
        "Registered vs attended",
        "Events that took registrations",
        regHeld.map((e) => ((nameCount.get(e.name) || 0) > 1 ? `${e.name} · ${shortDate(e.date)}` : e.name)),
        [
          { name: "Registered", color: SF, values: regHeld.map((e) => e.registered) },
          { name: "Attended", color: NV, values: regHeld.map((e) => Math.min(e.headcount as number, e.registered)) },
        ],
        { stack: false },
      ),
    );
  }

  // Average attendance by type
  const counted = held.filter((e) => e.headcount != null);
  const typeAvg = TYPES.map((t) => {
    const evs = counted.filter((e) => e.type === t);
    return { t, n: evs.length, avg: evs.length ? Math.round(sum(evs.map((e) => e.headcount as number)) / evs.length) : 0 };
  }).filter((x) => x.n > 0);
  if (typeAvg.length > 0) {
    sections.push(
      hbars(
        "avg-type",
        "Average attendance by type",
        "Per event held with a headcount",
        typeAvg.map((x) => ({ label: TYPEL[x.t], value: x.avg, color: TYPEC[x.t], sub: `${x.n} ${x.n === 1 ? "event" : "events"}` })),
      ),
    );
  }

  // Weekly vs special
  if (counted.length > 0) {
    const weekly = counted.filter((e) => e.weekly);
    const special = counted.filter((e) => !e.weekly);
    const avg = (evs: Ev[]) => (evs.length ? Math.round(sum(evs.map((e) => e.headcount as number)) / evs.length) : null);
    const best = held
      .filter((e) => turnupOf(e) != null)
      .sort((a, b) => (turnupOf(b) as number) - (turnupOf(a) as number))[0];
    const items: { label: string; value: string; sub?: string; color?: string }[] = [
      { label: "Weekly events, average", value: avg(weekly) == null ? "—" : nf(avg(weekly)), sub: `${weekly.length} ${weekly.length === 1 ? "event" : "events"}` },
      { label: "Special events, average", value: avg(special) == null ? "—" : nf(avg(special)), sub: `${special.length} ${special.length === 1 ? "event" : "events"}` },
    ];
    if (best) items.push({ label: "Best turn-up", value: `${Math.round(turnupOf(best) as number)}%`, sub: best.name, color: GN });
    sections.push(stats("weekly-special", "Weekly vs special events", "Average attendance per event", items));
  }

  // Day and time
  const timed = counted.filter((e) => slotOf(e.startTime) != null);
  if (timed.length > 0) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const heatRows = order
      .map((dow) => {
        const evs = timed.filter((e) => e.date.getUTCDay() === dow);
        if (!evs.length) return null;
        return {
          label: DOW_LONG[dow],
          cells: SLOTS.map((_, slot) => {
            const inSlot = evs.filter((e) => slotOf(e.startTime) === slot);
            return attCell(inSlot.length ? Math.round(sum(inSlot.map((e) => e.headcount as number)) / inSlot.length) : null);
          }),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const untimed = counted.length - timed.length;
    sections.push(
      heat("day-time", "Day and time", "Average attendance by day and time slot", SLOTS, heatRows, {
        note:
          "Morning before 12:00 · Afternoon 12:00–17:00 · Evening 17:00–20:00 · Night after 20:00." +
          (untimed > 0 ? ` ${untimed} ${untimed === 1 ? "event has" : "events have"} no start time and ${untimed === 1 ? "is" : "are"} left out.` : ""),
      }),
    );
  }

  // Coming up
  if (upcoming.length > 0) {
    const flagged = new Set(underReg.map((e) => e.id));
    const shown = upcoming.slice(0, 8);
    const nextLabel =
      ctx.periodType === "MONTHLY"
        ? ctx.to.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })
        : ctx.periodType === "WEEKLY"
          ? "the next week"
          : ctx.periodType === "QUARTERLY"
            ? "the next quarter"
            : ctx.periodType === "ANNUAL"
              ? String(ctx.to.getUTCFullYear())
              : "the next period";
    sections.push(
      hbars(
        "upcoming",
        `Coming up${ctx.now < ctx.to ? "" : ` in ${nextLabel}`}`,
        "Registrations so far against capacity",
        shown.map((e) => {
          const hasCap = !!e.capacity && e.capacity > 0;
          return {
            label: e.name,
            value: e.registered,
            display: hasCap ? `${nf(e.registered)} of ${nf(e.capacity)}` : `${nf(e.registered)} registered`,
            color: flagged.has(e.id) ? BZ : NV,
            sub: hasCap ? `${shortDate(e.date)} · ${Math.round(pctOf(e.registered, e.capacity as number))}% full` : `${shortDate(e.date)} · no capacity set`,
            max: hasCap ? (e.capacity as number) : undefined,
          };
        }),
        { note: upcoming.length > shown.length ? `Next ${shown.length} of ${upcoming.length} events that take registrations.` : undefined },
      ),
    );
  }

  /* By branch */
  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "events",
      ["Events", "Registrations", "Turn-up", "Visitors", "Attendance"],
      ctx.branches.map((b) => {
        const m = metrics(held.filter((e) => e.branchId === b.id));
        return {
          branch: b.name,
          values: [m.held, m.registrations, m.turnup == null ? "—" : `${Math.round(m.turnup)}%`, m.visitors, m.attendance],
        };
      }),
    );
  }

  const empty = inPeriod.length === 0;
  return {
    body: {
      kpis,
      flags: empty ? [] : sortedFlags,
      highlights: empty ? [] : highlights.slice(0, 4),
      sections: empty ? [] : sections,
      by_branch: empty ? null : by_branch,
      headline: [0, 2],
      health: healthOf(empty ? [] : sortedFlags),
      provisional_note: null,
      empty,
    },
    facts: {
      events_held: cur.held,
      total_event_attendance: cur.attendance,
    },
  };
};
