/**
 * Visitors and follow-up report.
 *
 * Definitions reuse visitorManagement:
 * - First-time visitor = visitor whose `visitDate` (first visit) falls in the range.
 * - Returning visitor = someone who first came before the range and has a
 *   `visit` row inside it (distinct visitors).
 * - A follow-up is done when its status is "completed" (Frontend
 *   isCompletedStatus). Follow-ups "due" in a range are those dated in it, up
 *   to now. The follow-up person is `follow_up.assignedTo`, falling back to the
 *   visitor's first responsible member.
 * - Became a member = user created in the range with `source_visitor_id` set
 *   (set by convertVisitorToMember / registerUser).
 * - Days to first follow-up = first completed follow-up date minus first visit,
 *   averaged over first-time visitors in the range who have one.
 * - Backlog flags look at visitors who first came in the 90 days up to the
 *   period end and are not yet members; "7 days" is measured against today.
 * - "Local" = resident country Ghana (stored as name or code); the church does
 *   not store a home country setting.
 *
 * Dropped / adapted from the design mock (no data behind them):
 * - Marital status in "Visitor profile": the visitor form sends it but the
 *   visitor table has no column for it.
 * - "Radio or TV" / "Walked in" / "Came for an event" sources: how-heard only
 *   stores friend / advertisement / social media / other, shown as recorded.
 * - "Which events bring visitors" counts visits by this period's first-time
 *   visitors per event, since a visitor's first visit is not tied to one event.
 * - Funnel "Asked about membership" uses the membershipWish checkbox captured
 *   at registration.
 */
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere, getRelationBranchScopedWhere } from "../../branches/branchService";
import { addDays, shortDate } from "../period";
import {
  BZ,
  GR,
  NV,
  SF,
  bars,
  byBranch,
  changeWords,
  emptyBody,
  flag,
  funnel,
  hbars,
  healthOf,
  inRange,
  kpi,
  list,
  nf,
  pctOf,
  pill,
  round1,
  segments,
  sortFlags,
  table,
} from "../sections";
import { ReportBuilder, ReportContext } from "../types";

const DAY = 86_400_000;
const OPEN_LIMIT = 10;
const BACKLOG_WINDOW_DAYS = 90;
const NO_FOLLOW_UP_DAYS = 7;
const VISITORS_PATH = "/home/visitors";

const isDone = (status: string | null | undefined) =>
  String(status || "").trim().toLowerCase() === "completed";
const isPending = (status: string | null | undefined) =>
  String(status || "").trim().toLowerCase() === "pending";

const HOW_HEARD: Record<string, string> = {
  friend: "Friend or member",
  advertisement: "Advertisement",
  social_media: "Social media",
  other: "Other",
};
const howHeardLabel = (value: string | null) => {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "Not recorded";
  if (HOW_HEARD[key]) return HOW_HEARD[key];
  const text = key.replace(/[_-]+/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const LOCAL_COUNTRIES = new Set(["ghana", "gh", "gha"]);

/** responsibleMembers is a JSON array (or comma list) of user ids. */
const responsibleIds = (raw: string | null): number[] => {
  if (!raw || !raw.trim()) return [];
  let values: unknown[] = [];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : [];
  } catch {
    values = raw.split(",");
  }
  return values.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
};

const fullName = (v: { title?: string | null; firstName: string; lastName: string }) =>
  [v.title, v.firstName, v.lastName].filter((p) => p && String(p).trim()).join(" ");

type Branch = number | null;
const inBranch = (branchId: number | null | undefined, branch: Branch) =>
  branch === null || branchId === branch;

export const buildVisitors: ReportBuilder = async (ctx: ReportContext) => {
  const now = ctx.now;
  const backlogFrom = addDays(ctx.to, -BACKLOG_WINDOW_DAYS);
  const spanFrom = new Date(
    Math.min(ctx.trend[0]?.from.getTime() ?? ctx.from.getTime(), ctx.prev.from.getTime(), ctx.yoy.from.getTime(), backlogFrom.getTime(), ctx.from.getTime()),
  );
  const spanTo = new Date(Math.max(ctx.to.getTime(), ctx.trend[ctx.trend.length - 1]?.to.getTime() ?? 0));
  const span = { gte: spanFrom, lt: spanTo };

  const visitorScope = getBranchScopedWhere(ctx.branchId) || {};
  const viaVisitor = getRelationBranchScopedWhere(ctx.branchId, "visitor") || {};
  const viaSourceVisitor = getRelationBranchScopedWhere(ctx.branchId, "source_visitor") || {};

  const [visitors, visits, followUps, converted, openByPerson, clergy] = await Promise.all([
    prisma.visitor.findMany({
      where: { ...visitorScope, visitDate: span },
      select: {
        id: true,
        title: true,
        firstName: true,
        lastName: true,
        visitDate: true,
        branch_id: true,
        is_member: true,
        membershipWish: true,
        gender: true,
        country: true,
        howHeard: true,
        responsibleMembers: true,
      },
    }),
    prisma.visit.findMany({
      where: { ...viaVisitor, date: span },
      select: { visitorId: true, date: true, eventId: true, visitor: { select: { visitDate: true, branch_id: true } } },
    }),
    // Follow-ups dated in the span, plus every follow-up of visitors first seen
    // in the span (for days-to-first-follow-up and the backlog).
    prisma.follow_up.findMany({
      where: { AND: [viaVisitor, { OR: [{ date: span }, { visitor: { is: { visitDate: span } } }] }] },
      select: { visitorId: true, date: true, status: true, assignedTo: true, visitor: { select: { visitDate: true, branch_id: true } } },
    }),
    prisma.user.findMany({
      where: { ...viaSourceVisitor, source_visitor_id: { not: null }, created_at: span },
      select: { created_at: true, source_visitor: { select: { branch_id: true } } },
    }),
    // All-time open follow-ups per person (workload limit).
    prisma.follow_up.groupBy({
      by: ["assignedTo"],
      where: { ...viaVisitor, assignedTo: { not: null }, NOT: { status: "completed" } },
      _count: { _all: true },
    }),
    prisma.visitor.findMany({
      where: {
        ...visitorScope,
        isClergy: true,
        OR: [{ visitDate: { gte: ctx.from, lt: ctx.to } }, { visits: { some: { date: { gte: ctx.from, lt: ctx.to } } } }],
      },
      select: {
        title: true,
        firstName: true,
        lastName: true,
        churchName: true,
        churchLocation: true,
        churchRole: true,
        visitDate: true,
        visits: { where: { date: { gte: ctx.from, lt: ctx.to } }, select: { date: true }, orderBy: { date: "desc" }, take: 1 },
      },
      take: 20,
    }),
  ]);

  // First completed follow-up per visitor.
  const firstDone = new Map<number, Date>();
  const doneVisitors = new Set<number>();
  const latestAssignee = new Map<number, { date: Date; userId: number }>();
  for (const f of followUps) {
    if (isDone(f.status)) {
      doneVisitors.add(f.visitorId);
      const seen = firstDone.get(f.visitorId);
      if (!seen || f.date < seen) firstDone.set(f.visitorId, f.date);
    }
    if (f.assignedTo) {
      const seen = latestAssignee.get(f.visitorId);
      if (!seen || f.date > seen.date) latestAssignee.set(f.visitorId, { date: f.date, userId: f.assignedTo });
    }
  }

  /** Every KPI for one range (and optionally one branch) from the loaded rows. */
  const metrics = (from: Date, to: Date, branch: Branch = null) => {
    const firstTimers = visitors.filter((v) => inBranch(v.branch_id, branch) && inRange(v.visitDate, from, to));
    const returning = new Set(
      visits
        .filter((v) => v.visitorId && v.visitor && inBranch(v.visitor.branch_id, branch) && inRange(v.date, from, to) && v.visitor.visitDate < from)
        .map((v) => v.visitorId as number),
    ).size;
    const dueTo = to < now ? to : now;
    const due = followUps.filter((f) => inBranch(f.visitor.branch_id, branch) && inRange(f.date, from, dueTo));
    const done = due.filter((f) => isDone(f.status)).length;
    const became = converted.filter((u) => inBranch(u.source_visitor?.branch_id, branch) && inRange(u.created_at, from, to)).length;
    const gaps = firstTimers
      .map((v) => {
        const d = firstDone.get(v.id);
        return d ? (d.getTime() - v.visitDate.getTime()) / DAY : null;
      })
      .filter((g): g is number => g !== null && g >= 0);
    return {
      firstTime: firstTimers.length,
      returning,
      due: due.length,
      done,
      donePct: due.length ? pctOf(done, due.length) : null,
      became,
      daysToFirst: gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    };
  };

  const cur = metrics(ctx.from, ctx.to);
  const prev = metrics(ctx.prev.from, ctx.prev.to);
  const yoy = metrics(ctx.yoy.from, ctx.yoy.to);
  const trend = ctx.trend.map((b) => metrics(b.from, b.to));
  const labels = ctx.trend.map((b) => b.label);

  const firstTimers = visitors.filter((v) => inRange(v.visitDate, ctx.from, ctx.to));
  const periodVisits = visits.filter((v) => inRange(v.date, ctx.from, ctx.to));
  const periodFollowUps = followUps.filter((f) => inRange(f.date, ctx.from, ctx.to));

  const facts = {
    first_time_visitors: cur.firstTime,
    returning_visitors: cur.returning,
    followups_done_pct: cur.donePct,
    became_members: cur.became,
    days_to_first_followup: cur.daysToFirst,
  };

  if (!firstTimers.length && !periodVisits.length && !periodFollowUps.length && !cur.became && !clergy.length) {
    return { body: { ...emptyBody(), headline: [0, 2], empty: true }, facts };
  }

  // Visit counts per first-time visitor (journey funnel, "came back" sub).
  const firstTimerIds = new Set(firstTimers.map((v) => v.id));
  const visitCount = new Map<number, number>();
  for (const v of visits) {
    if (v.visitorId && firstTimerIds.has(v.visitorId)) visitCount.set(v.visitorId, (visitCount.get(v.visitorId) || 0) + 1);
  }
  const cameBack = firstTimers.filter((v) => (visitCount.get(v.id) || 0) >= 2).length;
  const threePlus = firstTimers.filter((v) => (visitCount.get(v.id) || 0) >= 3).length;

  // Backlog: recent visitors, not members, never followed up.
  const noFollowUpCutoff = addDays(now, -NO_FOLLOW_UP_DAYS);
  const backlog = visitors.filter(
    (v) => !v.is_member && !doneVisitors.has(v.id) && v.visitDate >= backlogFrom && v.visitDate < ctx.to,
  );
  const waiting = backlog.filter((v) => v.visitDate < noFollowUpCutoff).sort((a, b) => a.visitDate.getTime() - b.visitDate.getTime());
  const wishUncontacted = backlog.filter((v) => v.membershipWish);

  // Workload per follow-up person for the period.
  type Load = { assigned: number; pending: number; progress: number; done: number; overdue: number };
  const loads = new Map<number, Load>();
  let unassigned = 0;
  for (const f of periodFollowUps) {
    if (!f.assignedTo) {
      unassigned += 1;
      continue;
    }
    const row = loads.get(f.assignedTo) || { assigned: 0, pending: 0, progress: 0, done: 0, overdue: 0 };
    row.assigned += 1;
    if (isDone(f.status)) row.done += 1;
    else {
      if (isPending(f.status)) row.pending += 1;
      else row.progress += 1;
      if (f.date < now) row.overdue += 1;
    }
    loads.set(f.assignedTo, row);
  }
  const openMap = new Map<number, number>(
    openByPerson.filter((g) => g.assignedTo).map((g) => [g.assignedTo as number, g._count._all]),
  );
  const overloaded = Array.from(openMap.entries()).filter(([, n]) => n > OPEN_LIMIT).sort((a, b) => b[1] - a[1]);

  // Names for people and events in one query each.
  const waitingShown = waiting.slice(0, 6);
  const assigneeOf = (v: (typeof visitors)[number]) => latestAssignee.get(v.id)?.userId ?? responsibleIds(v.responsibleMembers)[0] ?? null;
  const userIds = Array.from(
    new Set([
      ...Array.from(loads.keys()),
      ...overloaded.map(([id]) => id),
      ...waitingShown.map(assigneeOf).filter((id): id is number => id !== null),
    ]),
  );
  const firstTimerVisits = periodVisits.filter((v) => v.visitorId && firstTimerIds.has(v.visitorId) && v.eventId);
  const eventIds = Array.from(new Set(firstTimerVisits.map((v) => v.eventId as number)));
  const [users, events] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    eventIds.length
      ? prisma.event_mgt.findMany({ where: { id: { in: eventIds } }, select: { id: true, event: { select: { event_name: true } } } })
      : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name || `Member #${u.id}`]));
  const nameOf = (id: number) => userName.get(id) || `Member #${id}`;

  /* KPIs */
  const kpis = [
    kpi("first_time", "First-time visitors", cur.firstTime, {
      prev: prev.firstTime,
      yoy: yoy.firstTime,
      spark: trend.map((t) => t.firstTime),
    }),
    kpi("returning", "Returning visitors", cur.returning, {
      prev: prev.returning,
      yoy: yoy.returning,
      spark: trend.map((t) => t.returning),
      sub: cur.firstTime ? `${Math.round(pctOf(cameBack, cur.firstTime))}% of first-timers came back at least once` : null,
    }),
    kpi("followups_done", "Follow-ups done", cur.donePct, {
      format: "pct",
      prev: prev.donePct,
      yoy: yoy.donePct,
      spark: trend.map((t) => t.donePct ?? 0),
      sub: cur.due ? `${nf(cur.done)} of ${nf(cur.due)} due` : "No follow-ups due",
    }),
    kpi("became_members", "Became members", cur.became, {
      prev: prev.became,
      yoy: yoy.became,
      spark: trend.map((t) => t.became),
    }),
    kpi("days_to_followup", "Days to first follow-up", cur.daysToFirst, {
      format: "days",
      good: "down",
      prev: prev.daysToFirst,
      yoy: yoy.daysToFirst,
      spark: trend.map((t) => t.daysToFirst ?? 0),
    }),
  ];

  /* Flags */
  const flags = [];
  if (waiting.length) {
    flags.push(
      flag(
        "act",
        `${nf(waiting.length)} visitor${waiting.length === 1 ? " has" : "s have"} had no follow-up after ${NO_FOLLOW_UP_DAYS} days`,
        `View ${nf(waiting.length)} visitor${waiting.length === 1 ? "" : "s"}`,
        VISITORS_PATH,
      ),
    );
  }
  if (wishUncontacted.length) {
    flags.push(
      flag(
        "act",
        `${nf(wishUncontacted.length)} visitor${wishUncontacted.length === 1 ? "" : "s"} asked about membership but nobody has contacted them`,
        `View ${nf(wishUncontacted.length)} visitor${wishUncontacted.length === 1 ? "" : "s"}`,
        VISITORS_PATH,
      ),
    );
  }
  for (const [id, open] of overloaded.slice(0, 3)) {
    flags.push(flag("watch", `${nameOf(id)} has ${nf(open)} open follow-ups, above the limit of ${OPEN_LIMIT}`, "View visitors", VISITORS_PATH));
  }
  if (overloaded.length > 3) {
    const more = overloaded.length - 3;
    flags.push(
      flag(
        "watch",
        `${more} more follow-up ${more === 1 ? "person has" : "people have"} over ${OPEN_LIMIT} open follow-ups`,
        "View visitors",
        VISITORS_PATH,
      ),
    );
  }
  const sortedFlags = sortFlags(flags);

  /* Sources */
  const sourceCounts = new Map<string, number>();
  for (const v of firstTimers) {
    const label = howHeardLabel(v.howHeard);
    sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
  }
  const sources = Array.from(sourceCounts.entries())
    .sort((a, b) => (a[0] === "Not recorded" ? 1 : b[0] === "Not recorded" ? -1 : b[1] - a[1]))
    .map(([label, value]) => ({ label, value }));

  /* Highlights */
  const highlights: string[] = [];
  highlights.push(
    `${ctx.periodLabel} brought ${nf(cur.firstTime)} first-time visitor${cur.firstTime === 1 ? "" : "s"}${changeWords(cur.firstTime, prev.firstTime, ctx.prev.label)}.`,
  );
  const topSource = sources.find((s) => s.label !== "Not recorded");
  if (topSource && cur.firstTime) {
    highlights.push(
      `${topSource.label} brought in ${Math.round(pctOf(topSource.value, cur.firstTime))}% of first-time visitors, the biggest source.`,
    );
  }
  if (cur.donePct !== null) {
    const pct = Math.round(cur.donePct);
    let line =
      prev.donePct === null
        ? `Follow-up completion was ${pct}% (${nf(cur.done)} of ${nf(cur.due)} due).`
        : pct > Math.round(prev.donePct)
          ? `Follow-up completion rose to ${pct}% from ${Math.round(prev.donePct)}%.`
          : pct < Math.round(prev.donePct)
            ? `Follow-up completion slipped to ${pct}% from ${Math.round(prev.donePct)}%.`
            : `Follow-up completion held at ${pct}%.`;
    const behind = Array.from(loads.values()).filter((l) => l.overdue > 0).length;
    if (behind && cur.done < cur.due) line += ` ${behind === 1 ? "One follow-up person is" : `${behind} follow-up people are`} behind.`;
    highlights.push(line);
  }
  if (cur.became) {
    const bestInTrend = trend.length > 1 && cur.became >= Math.max(...trend.map((t) => t.became));
    highlights.push(
      `${nf(cur.became)} visitor${cur.became === 1 ? "" : "s"} became member${cur.became === 1 ? "" : "s"}${bestInTrend ? ", the most in the trend window" : changeWords(cur.became, prev.became, ctx.prev.label)}.`,
    );
  }

  /* Sections */
  const sections = [];
  sections.push(
    bars(
      "trend",
      "Visitor trend",
      "First-time and returning visitors",
      labels,
      [
        { name: "First-time", color: NV, values: trend.map((t) => t.firstTime) },
        { name: "Returning", color: BZ, values: trend.map((t) => t.returning) },
      ],
      { full: true, stack: false },
    ),
  );
  if (sources.length) {
    sections.push(hbars("sources", "How they heard about us", "First-time visitors by source", sources));
  }
  if (cur.firstTime) {
    const wish = firstTimers.filter((v) => v.membershipWish).length;
    const members = firstTimers.filter((v) => v.is_member).length;
    sections.push(
      funnel("journey", "Visitor journey", "This period's first-time visitors, from first visit to membership", [
        { label: "1st visit", value: cur.firstTime },
        { label: "2nd visit", value: cameBack },
        { label: "3 or more visits", value: threePlus },
        { label: "Asked about membership", value: wish },
        { label: "Became a member", value: members },
      ]),
    );
  }
  if (loads.size) {
    const rows = Array.from(loads.entries())
      .sort((a, b) => b[1].assigned - a[1].assigned)
      .map(([id, l]) => {
        const open = openMap.get(id) || 0;
        const status =
          open > OPEN_LIMIT ? pill("danger", "Overloaded") : l.overdue >= 3 ? pill("warning", "Behind") : pill("success", "On track");
        return {
          cells: [
            { text: nameOf(id), bold: true },
            nf(l.assigned),
            nf(l.pending),
            nf(l.progress),
            nf(l.done),
            nf(l.overdue),
            { pill: status },
          ],
          keys: [nameOf(id), l.assigned, l.pending, l.progress, l.done, l.overdue, open > OPEN_LIMIT ? 0 : l.overdue >= 3 ? 1 : 2],
        };
      });
    sections.push(
      table(
        "fu",
        "Follow-up workload",
        "Follow-ups dated this period, by follow-up person. Click a column to sort.",
        [
          ["Follow-up person", "minmax(170px,1.5fr)"],
          ["Assigned", "90px", "right"],
          ["Pending", "80px", "right"],
          ["In progress", "100px", "right"],
          ["Done", "70px", "right"],
          ["Overdue", "80px", "right"],
          ["Status", "120px"],
        ],
        rows,
        {
          full: true,
          sortable: true,
          minWidth: "780px",
          note: unassigned ? `${nf(unassigned)} follow-up${unassigned === 1 ? " has" : "s have"} nobody assigned.` : undefined,
        },
      ),
    );
  }
  if (firstTimerVisits.length) {
    const eventName = new Map(events.map((e) => [e.id, e.event?.event_name || `Event #${e.id}`]));
    const byEvent = new Map<string, number>();
    for (const v of firstTimerVisits) {
      const name = eventName.get(v.eventId as number) || `Event #${v.eventId}`;
      byEvent.set(name, (byEvent.get(name) || 0) + 1);
    }
    const rows = Array.from(byEvent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));
    sections.push(
      hbars("events", "Which events bring visitors", "Visits by first-time visitors, by service or event", rows, {
        note: byEvent.size > 8 ? `Showing 8 of ${byEvent.size} events.` : undefined,
      }),
    );
  }
  if (waiting.length) {
    sections.push(
      list(
        "no-followup",
        `No follow-up after ${NO_FOLLOW_UP_DAYS} days`,
        "Visitors waiting longest for a call",
        waitingShown.map((v) => {
          const assignee = assigneeOf(v);
          const days = Math.floor((now.getTime() - v.visitDate.getTime()) / DAY);
          return {
            title: fullName(v),
            sub: `Visited ${shortDate(v.visitDate)} · ${assignee ? `assigned to ${nameOf(assignee)}` : "nobody assigned"}`,
            pill: pill("danger", `${days} days`),
            pii: true,
          };
        }),
        { note: waiting.length > waitingShown.length ? `Showing ${waitingShown.length} of ${nf(waiting.length)}.` : undefined },
      ),
    );
  }
  if (clergy.length) {
    sections.push(
      list(
        "clergy",
        "Visiting clergy",
        "Ministers who worshipped with us",
        clergy
          .map((c) => ({ c, date: c.visits[0]?.date ?? c.visitDate }))
          .sort((a, b) => a.date.getTime() - b.date.getTime())
          .map(({ c, date }) => ({
            title: fullName(c),
            sub: [c.churchRole, [c.churchName, c.churchLocation].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined,
            right: shortDate(date),
            pii: true,
          })),
      ),
    );
  }
  if (cur.firstTime) {
    const count = (pred: (v: (typeof firstTimers)[number]) => boolean) => firstTimers.filter(pred).length;
    const g = (v: (typeof firstTimers)[number]) => String(v.gender || "").trim().toLowerCase();
    const c = (v: (typeof firstTimers)[number]) => String(v.country || "").trim().toLowerCase();
    sections.push(
      segments("profile", "Visitor profile", "First-time visitors this period", [
        {
          label: "Gender",
          parts: [
            { label: "Female", value: count((v) => g(v) === "female"), color: NV },
            { label: "Male", value: count((v) => g(v) === "male"), color: BZ },
            { label: "Not recorded", value: count((v) => g(v) !== "female" && g(v) !== "male"), color: GR },
          ],
        },
        {
          label: "Where from",
          parts: [
            { label: "Local", value: count((v) => LOCAL_COUNTRIES.has(c(v))), color: NV },
            { label: "Foreign", value: count((v) => !!c(v) && !LOCAL_COUNTRIES.has(c(v))), color: BZ },
            { label: "Not recorded", value: count((v) => !c(v)), color: SF },
          ],
        },
      ]),
    );
  }

  /* By branch */
  const by_branch =
    ctx.branchId === null && ctx.branches.length > 1
      ? byBranch(
          "visitors",
          ["First-time", "Returning", "Follow-ups done", "Became members"],
          ctx.branches.map((b) => {
            const m = metrics(ctx.from, ctx.to, b.id);
            return {
              branch: b.name,
              values: [m.firstTime, m.returning, m.donePct === null ? "—" : `${Math.round(m.donePct)}%`, m.became],
            };
          }),
        )
      : null;

  return {
    body: {
      kpis,
      flags: sortedFlags,
      highlights: highlights.slice(0, 4),
      sections,
      by_branch,
      headline: [0, 2],
      health: healthOf(sortedFlags),
      provisional_note: null,
      empty: false,
    },
    facts: {
      ...facts,
      no_followup_after_7_days: waiting.length,
      membership_wish_uncontacted: wishUncontacted.length,
    },
  };
};
