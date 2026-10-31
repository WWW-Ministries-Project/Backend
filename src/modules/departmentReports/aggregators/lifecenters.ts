/**
 * Life centers report.
 *
 * Definitions reuse lifeCenterMangement (getOverview + Frontend lcModel):
 * - Leader = a member whose role is the leader role (incl. "CENTER LEADER").
 * - Attendance at a meeting = attendee rows (attendees + first-timers).
 * - A soul "became a member" when soul_won.memberId is set or a user lists it
 *   as their source soul (converted_members).
 * - Overdue = no meeting for more than 14 days; Irregular = 3+ scheduled
 *   meetings in the period and fewer than 60% held; otherwise Healthy.
 * - Expected meetings count each center's meeting days from max(period start,
 *   center created) to min(period end, yesterday).
 *
 * Dropped / adapted from the design mock (no data behind them):
 * - "Where souls are won by area": there is no area field; souls are grouped
 *   by the city captured when the soul was recorded.
 * - "Souls won not followed up": there is no follow-up record for souls, so
 *   the flag counts souls won in the period who have not attended any life
 *   center meeting yet.
 * - Offering covers GHS meetings only; other currencies are noted, not
 *   converted (no exchange rates stored).
 * - "Became members" is the soul's status today, not as at the period end.
 * - Centers deleted since the period are not in the data, so historic
 *   "x of y" denominators use the centers that exist today.
 */
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { isLeaderRoleName, parseMeetingDays } from "../../lifeCenterMangement/lifeCenterHelpers";
import { shortDate } from "../period";
import {
  BZ,
  NV,
  bars,
  byBranch,
  changeWords,
  emptyBody,
  flag,
  funnel,
  hbars,
  healthOf,
  heat,
  inRange,
  kpi,
  list,
  metCell,
  nf,
  pctOf,
  pill,
  round1,
  sortFlags,
  sum,
  table,
} from "../sections";
import { FlagDTO, ReportBuilder, SectionDTO, TableCell } from "../types";

const DAY = 86_400_000;
const OVERDUE_DAYS = 14;
const LC_LIST = "/home/life-centers";
const LC_ANALYTICS = "/home/life-centers/life-center-analytics";
const lcDetail = (id: number) => `/home/life-centers/life-center/${id}`;

const DOW_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const joinAnd = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const plural = (n: number, one: string, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const buildLifeCenters: ReportBuilder = async (ctx) => {
  const branchWhere = getBranchScopedWhere(ctx.branchId) ?? {};

  const centers = await prisma.life_center.findMany({
    where: branchWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      branch_id: true,
      meetingDays: true,
      createdAt: true,
      life_center_member: {
        select: { role: { select: { name: true } }, user: { select: { name: true } } },
      },
    },
  });

  if (!centers.length) {
    return {
      body: { ...emptyBody(), empty: true },
      facts: { souls_won: 0, souls_became_members: 0, centers_meeting: 0, centers_total: 0 },
    };
  }

  const centerIds = centers.map((c) => c.id);
  const windowFrom = new Date(
    Math.min(ctx.trend[0]?.from.getTime() ?? ctx.from.getTime(), ctx.prev.from.getTime(), ctx.yoy.from.getTime(), ctx.from.getTime()),
  );
  const windowTo = new Date(Math.max(ctx.to.getTime(), ctx.trend[ctx.trend.length - 1]?.to.getTime() ?? 0));

  const [meetings, attendeeCounts, souls, periodSoulAttendance, lastMet] = await Promise.all([
    prisma.life_center_meeting.findMany({
      where: { lifeCenterId: { in: centerIds }, date: { gte: windowFrom, lt: windowTo } },
      select: { id: true, lifeCenterId: true, date: true, offeringAmount: true, currency: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    prisma.life_center_meeting_attendee.groupBy({
      by: ["meetingId", "isFirstTimer"],
      where: { meeting: { lifeCenterId: { in: centerIds }, date: { gte: windowFrom, lt: windowTo } } },
      _count: { _all: true },
    }),
    prisma.soul_won.findMany({
      where: { lifeCenterId: { in: centerIds }, date_won: { gte: windowFrom, lt: windowTo } },
      select: {
        id: true,
        lifeCenterId: true,
        date_won: true,
        city: true,
        memberId: true,
        wonById: true,
        wonBy: { select: { name: true } },
        _count: { select: { converted_members: true } },
      },
    }),
    prisma.life_center_meeting_attendee.groupBy({
      by: ["soulWonId"],
      where: { soulWon: { lifeCenterId: { in: centerIds }, date_won: { gte: ctx.from, lt: ctx.to } } },
      _count: { _all: true },
    }),
    prisma.life_center_meeting.groupBy({
      by: ["lifeCenterId"],
      where: { lifeCenterId: { in: centerIds }, date: { lt: ctx.to } },
      _max: { date: true },
    }),
  ]);

  /* ------------------------------ indexes ------------------------------ */

  const people = new Map<number, { attendees: number; firstTimers: number }>();
  for (const row of attendeeCounts) {
    const cur = people.get(row.meetingId) ?? { attendees: 0, firstTimers: 0 };
    if (row.isFirstTimer) cur.firstTimers += row._count._all;
    else cur.attendees += row._count._all;
    people.set(row.meetingId, cur);
  }
  const peopleAt = (id: number) => {
    const p = people.get(id);
    return p ? p.attendees + p.firstTimers : 0;
  };
  const firstTimersAt = (id: number) => people.get(id)?.firstTimers ?? 0;

  const lastMetBy = new Map<number, Date>();
  for (const row of lastMet) if (row._max.date) lastMetBy.set(row.lifeCenterId, row._max.date);

  const isConverted = (s: (typeof souls)[number]) => Boolean(s.memberId) || s._count.converted_members > 0;
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const centerBranch = new Map(centers.map((c) => [c.id, c.branch_id]));

  /* ----------------------------- per range ----------------------------- */

  const yesterdayEnd = utcDay(ctx.now); // exclusive: counts up to yesterday
  const ref = new Date(Math.min(ctx.to.getTime(), ctx.now.getTime()));

  const expectedFor = (center: (typeof centers)[number], from: Date, to: Date) => {
    const days = new Set(parseMeetingDays(center.meetingDays).map((d) => d.slice(0, 3).toLowerCase()));
    if (!days.size) return 0;
    let cursor = utcDay(new Date(Math.max(from.getTime(), center.createdAt.getTime())));
    if (cursor < from) cursor = new Date(cursor.getTime() + DAY);
    const end = Math.min(to.getTime(), yesterdayEnd.getTime());
    let count = 0;
    for (; cursor.getTime() < end; cursor = new Date(cursor.getTime() + DAY)) {
      if (days.has(DOW_SHORT[cursor.getUTCDay()])) count += 1;
    }
    return count;
  };

  type Agg = {
    held: number;
    people: number;
    firstTimers: number;
    offering: number;
    otherCurrency: number;
    meetingCenters: Set<number>;
    centersTotal: number;
    souls: number;
    converted: number;
  };
  const aggregate = (from: Date, to: Date, ids?: Set<number>): Agg => {
    const ms = meetings.filter((m) => inRange(m.date, from, to) && (!ids || ids.has(m.lifeCenterId)));
    const ss = souls.filter((s) => inRange(s.date_won, from, to) && (!ids || ids.has(s.lifeCenterId)));
    const gh = ms.filter((m) => m.currency === "GHS");
    return {
      held: ms.length,
      people: sum(ms.map((m) => peopleAt(m.id))),
      firstTimers: sum(ms.map((m) => firstTimersAt(m.id))),
      offering: sum(gh.map((m) => Number(m.offeringAmount ?? 0))),
      otherCurrency: ms.length - gh.length,
      meetingCenters: new Set(ms.map((m) => m.lifeCenterId)),
      centersTotal: centers.filter((c) => c.createdAt < to && (!ids || ids.has(c.id))).length,
      souls: ss.length,
      converted: ss.filter(isConverted).length,
    };
  };
  const avgOf = (a: Agg) => (a.held ? round1(a.people / a.held) : 0);

  const cur = aggregate(ctx.from, ctx.to);
  const prev = aggregate(ctx.prev.from, ctx.prev.to);
  const yoy = aggregate(ctx.yoy.from, ctx.yoy.to);
  const trend = ctx.trend.map((b) => aggregate(b.from, b.to));

  // A comparison is meaningful only when centers existed then.
  const cmp = (a: Agg, v: number) => (a.centersTotal > 0 ? v : null);

  /* -------------------------------- KPIs -------------------------------- */

  const otherNote = cur.otherCurrency
    ? `GHS only · ${plural(cur.otherCurrency, "meeting")} in other currencies`
    : null;

  const kpis = [
    kpi("centers_meeting", "Life centers meeting", cur.meetingCenters.size, {
      display: `${nf(cur.meetingCenters.size)} of ${nf(cur.centersTotal)}`,
      prev: cmp(prev, prev.meetingCenters.size),
      yoy: cmp(yoy, yoy.meetingCenters.size),
      spark: trend.map((t) => t.meetingCenters.size),
    }),
    kpi("meetings_held", "Meetings held", cur.held, {
      prev: cmp(prev, prev.held),
      yoy: cmp(yoy, yoy.held),
      spark: trend.map((t) => t.held),
    }),
    kpi("avg_attendance", "Average attendance", cur.held ? avgOf(cur) : null, {
      format: "dec",
      prev: prev.held ? avgOf(prev) : null,
      yoy: yoy.held ? avgOf(yoy) : null,
      spark: trend.map(avgOf),
      sub: cur.held ? "people per meeting" : null,
    }),
    kpi("first_timers", "First-timers", cur.firstTimers, {
      prev: cmp(prev, prev.firstTimers),
      yoy: cmp(yoy, yoy.firstTimers),
      spark: trend.map((t) => t.firstTimers),
    }),
    kpi("souls_won", "Souls won", cur.souls, {
      prev: cmp(prev, prev.souls),
      yoy: cmp(yoy, yoy.souls),
      spark: trend.map((t) => t.souls),
      sub: cur.souls ? `${nf(cur.converted)} became members (${Math.round(pctOf(cur.converted, cur.souls))}%)` : null,
    }),
    kpi("offering", "Offering", cur.offering, {
      format: "ghs",
      prev: cmp(prev, prev.offering),
      yoy: cmp(yoy, yoy.offering),
      spark: trend.map((t) => t.offering),
      sub: otherNote,
    }),
  ];

  /* --------------------------- per-center rows --------------------------- */

  const periodMeetings = meetings.filter((m) => inRange(m.date, ctx.from, ctx.to));
  const periodSouls = souls.filter((s) => inRange(s.date_won, ctx.from, ctx.to));

  const rows = centers
    .filter((c) => c.createdAt < ctx.to)
    .map((c) => {
      const ms = periodMeetings.filter((m) => m.lifeCenterId === c.id);
      const ss = periodSouls.filter((s) => s.lifeCenterId === c.id);
      const leader = c.life_center_member.find((m) => isLeaderRoleName(m.role?.name) && m.user)?.user?.name ?? null;
      const last = lastMetBy.get(c.id) ?? null;
      const since = last ?? c.createdAt;
      const gap = Math.floor((ref.getTime() - utcDay(since).getTime()) / DAY);
      const overdue = gap > OVERDUE_DAYS;
      const exp = expectedFor(c, ctx.from, ctx.to);
      const rate = exp ? Math.min(100, pctOf(ms.length, exp)) : 100;
      const status: "ok" | "irr" | "over" = overdue ? "over" : exp >= 3 && rate < 60 ? "irr" : "ok";
      const ppl = sum(ms.map((m) => peopleAt(m.id)));
      const converted = ss.filter(isConverted).length;
      // Last 4 meetings up to the period end, oldest first.
      const recent = meetings
        .filter((m) => m.lifeCenterId === c.id && m.date < ctx.to)
        .slice(-4)
        .map((m) => peopleAt(m.id));
      const falling = recent.length === 4 && recent.every((v, i) => i === 0 || v < recent[i - 1]);
      return {
        c,
        leader,
        members: c.life_center_member.length,
        held: ms.length,
        avg: ms.length ? round1(ppl / ms.length) : 0,
        firstTimers: sum(ms.map((m) => firstTimersAt(m.id))),
        souls: ss.length,
        converted,
        conversion: ss.length ? Math.round(pctOf(converted, ss.length)) : 0,
        last,
        gap,
        overdue,
        status,
        falling,
      };
    });

  /* -------------------------------- flags -------------------------------- */

  const flags: FlagDTO[] = [];
  const overdueRows = rows.filter((r) => r.overdue).sort((a, b) => b.gap - a.gap);
  if (overdueRows.length) {
    const names = overdueRows.map((r) => r.c.name);
    const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : joinAnd(names);
    flags.push(
      flag(
        "act",
        `${shown} ${overdueRows.length === 1 ? "life center has" : "life centers have"} not met for more than 2 weeks`,
        overdueRows.length === 1 ? "View center" : "View centers",
        overdueRows.length === 1 ? lcDetail(overdueRows[0].c.id) : LC_LIST,
      ),
    );
  }
  const noLeader = rows.filter((r) => !r.leader);
  if (noLeader.length) {
    flags.push(
      flag(
        "act",
        noLeader.length === 1
          ? `${noLeader[0].c.name} has no leader`
          : `${plural(noLeader.length, "life center")} have no leader: ${joinAnd(noLeader.slice(0, 3).map((r) => r.c.name))}${noLeader.length > 3 ? " and others" : ""}`,
        "Assign a leader",
        noLeader.length === 1 ? lcDetail(noLeader[0].c.id) : LC_LIST,
      ),
    );
  }
  const attendedSouls = new Set(periodSoulAttendance.filter((r) => r._count._all > 0).map((r) => r.soulWonId));
  const notFollowed = periodSouls.filter((s) => !attendedSouls.has(s.id) && !isConverted(s)).length;
  if (notFollowed > 0) {
    flags.push(
      flag(
        "watch",
        `${plural(notFollowed, "soul")} won ${notFollowed === 1 ? "has" : "have"} not been to a life center meeting yet`,
        "View souls",
        LC_ANALYTICS,
      ),
    );
  }
  for (const r of rows.filter((x) => x.falling && !x.overdue).slice(0, 3)) {
    flags.push(flag("watch", `${r.c.name} attendance has fallen 4 meetings in a row`, "View center", lcDetail(r.c.id)));
  }
  const sortedFlags = sortFlags(flags);

  /* ------------------------------ highlights ----------------------------- */

  const highlights: string[] = [];
  if (cur.souls > 0) {
    highlights.push(
      `${plural(cur.souls, "soul was", "souls were")} won in ${ctx.periodLabel}${changeWords(cur.souls, prev.souls, ctx.prev.label)}. ${
        cur.converted ? `${nf(cur.converted)} ${cur.converted === 1 ? "has" : "have"} already become ${cur.converted === 1 ? "a member" : "members"}.` : "None has become a member yet."
      }`,
    );
  } else {
    highlights.push(`No souls were recorded as won in ${ctx.periodLabel}.`);
  }
  const topCenter = rows.filter((r) => r.souls > 0).sort((a, b) => b.souls - a.souls)[0];
  highlights.push(
    `${nf(cur.meetingCenters.size)} of ${nf(cur.centersTotal)} life centers met at least once.${
      topCenter ? ` ${topCenter.c.name} led with ${plural(topCenter.souls, "soul")} won.` : ""
    }`,
  );
  if (cur.held > 0) {
    highlights.push(
      `Average attendance was ${avgOf(cur).toFixed(1)} per meeting across ${plural(cur.held, "meeting")}${changeWords(avgOf(cur), prev.held ? avgOf(prev) : null, ctx.prev.label)}.`,
    );
  }
  if (overdueRows.length) {
    const parts = overdueRows
      .slice(0, 3)
      .map((r) => (r.last ? `${r.c.name} last met on ${shortDate(r.last)}` : `${r.c.name} has never recorded a meeting`));
    highlights.push(
      `${overdueRows.length === 1 ? "One center has" : `${nf(overdueRows.length)} centers have`} gone quiet: ${joinAnd(parts)}.`,
    );
  }

  /* ------------------------------- sections ------------------------------- */

  const sections: SectionDTO[] = [];

  sections.push(
    bars(
      "souls-won",
      "Souls won",
      "Each period, split by whether they became members",
      ctx.trend.map((b) => b.label),
      [
        { name: "Became members", color: NV, values: trend.map((t) => t.converted) },
        { name: "Not yet members", color: BZ, values: trend.map((t) => t.souls - t.converted) },
      ],
      { full: true, stack: true },
    ),
  );

  if (cur.souls > 0) {
    const counts = new Map(periodSoulAttendance.map((r) => [r.soulWonId, r._count._all]));
    const periodIds = periodSouls.map((s) => s.id);
    const cameOnce = periodIds.filter((id) => (counts.get(id) ?? 0) >= 1).length;
    const cameThree = periodIds.filter((id) => (counts.get(id) ?? 0) >= 3).length;
    sections.push(
      funnel("journey", "Soul-winning journey", `What happened to the ${nf(cur.souls)} people won this period`, [
        { label: "Souls won", value: cur.souls },
        { label: "Came to a first meeting", value: cameOnce },
        { label: "Came to 3 or more meetings", value: cameThree },
        { label: "Became a member", value: cur.converted },
      ], { note: "Meetings attended up to today." }),
    );

    const byCity = new Map<string, number>();
    for (const s of periodSouls) {
      const city = (s.city || "").trim() || "Not recorded";
      byCity.set(city, (byCity.get(city) ?? 0) + 1);
    }
    const cities = Array.from(byCity.entries()).sort((a, b) => b[1] - a[1]);
    const top = cities.slice(0, 6).map(([label, value]) => ({ label, value }));
    const rest = sum(cities.slice(6).map(([, v]) => v));
    if (rest) top.push({ label: "Other", value: rest });
    sections.push(hbars("where-won", "Where souls are being won", "By city recorded for each soul", top));
  }

  const statusPill = (s: "ok" | "irr" | "over") =>
    s === "ok" ? pill("success", "● Healthy") : s === "irr" ? pill("warning", "● Irregular") : pill("danger", "● Overdue");
  const statusRank = { ok: 0, irr: 1, over: 2 };
  const board = rows.slice().sort((a, b) => b.souls - a.souls || b.held - a.held || a.c.name.localeCompare(b.c.name));
  sections.push(
    table(
      "lc",
      "Life center leaderboard",
      "Click a column to sort",
      [
        ["Life center", "minmax(160px,1.3fr)"],
        ["Leader", "150px"],
        ["Members", "80px", "right"],
        ["Meetings", "80px", "right"],
        ["Avg attendance", "110px", "right"],
        ["First-timers", "100px", "right"],
        ["Souls won", "90px", "right"],
        ["Conversion", "90px", "right"],
        ["Last met", "90px"],
        ["Status", "110px"],
      ],
      board.map((r) => ({
        cells: [
          { text: r.c.name, bold: true },
          r.leader ? r.leader : { pill: pill("danger", "No leader") },
          nf(r.members),
          nf(r.held),
          r.held ? r.avg.toFixed(1) : "—",
          nf(r.firstTimers),
          nf(r.souls),
          r.souls ? `${r.conversion}%` : "—",
          r.last ? shortDate(r.last) : "Never",
          { pill: statusPill(r.status) },
        ] as TableCell[],
        keys: [
          r.c.name,
          r.leader ?? "",
          r.members,
          r.held,
          r.avg,
          r.firstTimers,
          r.souls,
          r.conversion,
          r.last ? r.last.getTime() : 0,
          statusRank[r.status],
        ],
      })),
      { full: true, sortable: true, minWidth: "1140px" },
    ),
  );

  const winners = new Map<number, { name: string; count: number; centers: Map<number, number> }>();
  for (const s of periodSouls) {
    const w = winners.get(s.wonById) ?? { name: s.wonBy?.name ?? "Unknown", count: 0, centers: new Map() };
    w.count += 1;
    w.centers.set(s.lifeCenterId, (w.centers.get(s.lifeCenterId) ?? 0) + 1);
    winners.set(s.wonById, w);
  }
  const topWinners = Array.from(winners.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
  if (topWinners.length) {
    sections.push(
      list(
        "top-winners",
        "Top soul winners",
        "For recognition",
        topWinners.map((w) => {
          const mainCenter = Array.from(w.centers.entries()).sort((a, b) => b[1] - a[1])[0][0];
          return {
            title: w.name,
            sub: centerName.get(mainCenter) ?? "",
            right: plural(w.count, "soul"),
            pii: true,
          };
        }),
      ),
    );
  }

  if (ctx.weeks.length) {
    sections.push(
      heat(
        "regularity",
        "Meeting regularity",
        "Did each center meet that week?",
        ctx.weeks.map((w) => w.label),
        rows.map((r) => ({
          label: r.c.name,
          cells: ctx.weeks.map((w) => {
            if (w.from >= ctx.now || r.c.createdAt >= w.to) return metCell(null);
            return metCell(meetings.some((m) => m.lifeCenterId === r.c.id && inRange(m.date, w.from, w.to)));
          }),
        })),
        { full: rows.length > 0 && ctx.weeks.length > 6 },
      ),
    );
  }

  /* ------------------------------- by branch ------------------------------- */

  let by_branch: SectionDTO | null = null;
  if (ctx.branchId === null && ctx.branches.length > 1) {
    by_branch = byBranch(
      "lifecenters",
      ["Meeting", "Meetings held", "Souls won", "Conversion"],
      ctx.branches.map((b) => {
        const ids = new Set(centers.filter((c) => centerBranch.get(c.id) === b.id).map((c) => c.id));
        const a = aggregate(ctx.from, ctx.to, ids);
        return {
          branch: b.name,
          values: [
            `${nf(a.meetingCenters.size)} of ${nf(a.centersTotal)}`,
            a.held,
            a.souls,
            a.souls ? `${Math.round(pctOf(a.converted, a.souls))}%` : "—",
          ],
        };
      }),
    );
  }

  return {
    body: {
      ...emptyBody(),
      kpis,
      flags: sortedFlags,
      highlights: highlights.slice(0, 4),
      sections,
      by_branch,
      headline: [4, 0],
      health: healthOf(sortedFlags),
      empty: false,
    },
    facts: {
      souls_won: cur.souls,
      souls_became_members: cur.converted,
      centers_meeting: cur.meetingCenters.size,
      centers_total: cur.centersTotal,
    },
  };
};
