/**
 * Head-of-department workspace: "How is my department, and what do I need to do?"
 *
 * Scoped to one department the caller heads (`department.department_head`).
 * Team = roster from queries/hodQueries. Check-in rate = share of the team
 * checked in at Sunday services, over Sundays that have any check-in data.
 */
import { RequestApprovalStatus } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { deptAttKey, dueOnDayAfter } from "../../departmentReports/departmentAttendanceKey";
import { parsePeriod } from "../../departmentReports/period";
import { loadReportConfig } from "../../settings/reportConfigService";
import type { AgendaItem, Kpi, ListItem, NeedsItem, QueueItem, WorkspaceBuilder, WorkspaceContext } from "../types";
import { deltaPct, runWidgets } from "../widgetKit";
import { switchedOffEverywhere } from "../access";
import { lastSundays, loadRoster, packFor, sundayCheckins, type HodPack } from "../queries/hodQueries";
import {
  DAY,
  dayStart,
  eventAgendaItem,
  eventBranchWhere,
  eventSelect,
  ghs,
  isoDay,
  isPendingRequisition,
  loadStepLookups,
  monthYear,
  pctOf,
  pill,
  plural,
  requisitionListItem,
  requisitionSelect,
  requisitionValue,
  round1,
  shortDate,
  sum,
  within,
  type EventRow,
  type RequisitionRow,
} from "../queries/genericCommon";

type Entries = Parameters<typeof runWidgets>[1];

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const parseIds = (raw: unknown): number[] => {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = raw.split(",");
    }
  }
  return list.map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n > 0);
};

const isDone = (status: string | null | undefined) => String(status || "").trim().toLowerCase() === "completed";
const visitorName = (v: { title: string | null; firstName: string; lastName: string }) =>
  [v.title, v.firstName, v.lastName].filter(Boolean).join(" ");

const ASSET_LABEL: Record<string, string> = {
  ASSIGNED: "Assigned",
  UNASSIGNED: "Unassigned",
  NOT_FIXABLE: "Not fixable",
  OUT_OF_REPAIRS: "Out for repairs",
  LOST_OR_STOLEN: "Lost or stolen",
  NEEDS_REPAIR: "Needs repair",
};

export const buildHod: WorkspaceBuilder = async (ctx: WorkspaceContext) => {
  const now = ctx.range.to;
  // Clamped to the caller's branches (All branches = every allowed branch); branchless departments stay.
  const deptScope = getBranchScopedWhere(ctx.branchId);
  const headed = await prisma.department.findMany({
    where: {
      department_head: ctx.userId,
      ...(deptScope ? { OR: [deptScope, { branch_id: null }] } : {}),
    },
    select: { id: true, name: true, branch_id: true },
    orderBy: { name: "asc" },
  });
  const departments = headed.map((d) => ({ id: d.id, name: d.name, pack: packFor(d.name) as HodPack }));
  if (!headed.length) return { needs: [], widgets: {}, departments: [] };

  const dept = headed.find((d) => d.id === ctx.departmentId) || headed[0];
  const pack = packFor(dept.name);
  const deptBranch = dept.branch_id ?? ctx.branchId;
  const branchWhere: Record<string, unknown> = deptBranch
    ? { branch_id: deptBranch }
    : getBranchScopedWhere(ctx.branchId) || {};

  /* ---------- shared sources ---------- */
  const once = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= fn());
  };
  const roster = once(() => loadRoster(dept.id));
  const last8 = lastSundays(now, 8);
  const checkins = once(async () => {
    const team = await roster();
    // Sundays back to the start of the comparison period, or the last 8, whichever is earlier.
    const firstSunday = new Date(
      dayStart(ctx.range.prevFrom).getTime() + ((7 - ctx.range.prevFrom.getUTCDay()) % 7) * DAY,
    );
    const start = firstSunday < last8[0] ? firstSunday : last8[0];
    const sundays: Date[] = [];
    for (let d = start; d <= now; d = new Date(d.getTime() + 7 * DAY)) sundays.push(d);
    return sundayCheckins(sundays, team.map((u) => u.id), branchWhere);
  });
  // Latest few for the h-req list only; counts and sums below query the whole department.
  const deptRequests = once(
    () =>
      prisma.request.findMany({
        where: {
          department_id: dept.id,
          OR: [{ request_approval_status: { not: RequestApprovalStatus.Draft } }, { user_id: ctx.userId }],
        },
        select: requisitionSelect,
        orderBy: { id: "desc" },
        take: 5,
      }) as Promise<RequisitionRow[]>,
  );
  // Value is unitPrice x quantity per item, which Prisma can't aggregate; select only those columns.
  const pendingRequests = once(() =>
    prisma.request.findMany({
      where: {
        department_id: dept.id,
        request_approval_status: {
          in: [RequestApprovalStatus.Awaiting_HOD_Approval, RequestApprovalStatus.Awaiting_Executive_Pastor_Approval],
        },
      },
      select: { products: { select: { quantity: true, unitPrice: true } } },
    }),
  );
  const rateOf = (rows: { hasData: boolean; present: Set<number> }[], teamSize: number) => {
    const withData = rows.filter((r) => r.hasData);
    if (!withData.length || !teamSize) return null;
    return round1(sum(withData.map((r) => (r.present.size / teamSize) * 100)) / withData.length);
  };

  const counts = { joins: 0, rejected: 0, report: 0, reportLabel: "", pack: 0 };

  const core: Entries = [
    [
      "h-kpi",
      null,
      async () => {
        const [team, cks, pending, joinsNow, joinsPrev] = await Promise.all([
          roster(),
          checkins(),
          pendingRequests(),
          prisma.department_join_request.count({
            where: { department_id: dept.id, status: "APPROVED", decided_at: { gte: ctx.range.from, lte: ctx.range.to } },
          }),
          prisma.department_join_request.count({
            where: {
              department_id: dept.id,
              status: "APPROVED",
              decided_at: { gte: ctx.range.prevFrom, lte: ctx.range.prevTo },
            },
          }),
        ]);
        const inRange = (from: Date, to: Date) => cks.filter((c) => within(c.day, from, to));
        const rateNow = rateOf(inRange(ctx.range.from, ctx.range.to), team.length);
        const ratePrev = rateOf(inRange(ctx.range.prevFrom, ctx.range.prevTo), team.length);
        const pendingValue = sum(pending.map(requisitionValue));
        const kpis: Kpi[] = [
          {
            key: "team_members",
            label: "Team members",
            value: team.length,
            format: "n",
            // Approximation: today's roster against today's roster less this period's approved joins.
            delta_pct: deltaPct(team.length, team.length - joinsNow),
            good: "up",
            spark: [],
          },
          {
            key: "new_joins",
            label: "New joins",
            value: joinsNow,
            format: "n",
            delta_pct: deltaPct(joinsNow, joinsPrev),
            good: "up",
            spark: [],
          },
          {
            key: "checkin_rate",
            label: "Team check-in rate",
            value: rateNow,
            format: "pct",
            delta_pct: rateNow !== null && ratePrev !== null ? round1(rateNow - ratePrev) : null,
            points: true,
            good: "up",
            spark: cks
              .filter((c) => c.day >= last8[0] && c.hasData)
              .map((c) => (team.length ? round1((c.present.size / team.length) * 100) : 0)),
            ...(rateNow === null ? { sub: "No Sunday check-ins recorded" } : {}),
          },
          {
            key: "requisitions_in_approval",
            label: "Requisitions in approval",
            value: pending.length,
            format: "raw",
            delta_pct: null,
            good: null,
            spark: [],
            sub: pending.length ? `${ghs(pendingValue)} waiting` : "None waiting",
          },
        ];
        return { kpis };
      },
    ],
    [
      "h-join",
      null,
      async () => {
        // Heads decide their department's requests unless the role switched the action off.
        if (switchedOffEverywhere(await ctx.grants(), "Membership_Management", "decide_join_request")) {
          counts.joins = 0;
          return { items: [] as QueueItem[] };
        }
        const rows = await prisma.department_join_request.findMany({
          where: { department_id: dept.id, status: "PENDING" },
          orderBy: { requested_at: "asc" },
          take: 20,
          select: {
            id: true,
            requested_at: true,
            note: true,
            user: {
              select: {
                name: true,
                created_at: true,
                branch: { select: { name: true } },
                user_info: { select: { member_since: true } },
                department_positions: { select: { department: { select: { id: true, name: true } } } },
                department: { select: { department_info: { select: { id: true, name: true } } } },
              },
            },
          },
        });
        counts.joins = rows.length;
        const items: QueueItem[] = rows.map((r) => {
          const since = r.user.user_info?.member_since || r.user.created_at;
          const others = [
            ...new Map(
              [
                ...r.user.department_positions.map((p) => p.department),
                ...(r.user.department?.department_info ? [r.user.department.department_info] : []),
              ]
                .filter((d) => d.id !== dept.id)
                .map((d) => [d.id, d.name]),
            ).values(),
          ];
          const sub = [
            `Member since ${since.getUTCFullYear()}`,
            others.length ? `also in ${others.slice(0, 2).join(", ")}` : r.user.branch?.name || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            id: `join_request:${r.id}`,
            kind: "join_request",
            ref_id: r.id,
            title: r.user.name,
            sub,
            pill: null,
            detail: {
              fields: [
                ["Member", r.user.name],
                ["Department", dept.name],
                ["Branch", r.user.branch?.name || "Not set"],
                ["Member since", monthYear(since)],
                ["Current departments", others.length ? others.join(", ") : "None"],
                ["Requested on", shortDate(r.requested_at)],
              ],
              ...(r.note ? { text: r.note, text_label: "Note" } : {}),
            },
          };
        });
        return { items };
      },
    ],
    [
      "h-att",
      null,
      async () => {
        const [team, cks] = await Promise.all([roster(), checkins()]);
        const byDay = new Map(cks.map((c) => [c.day.getTime(), c]));
        return {
          // rate is null for a Sunday with no check-in data.
          points: last8.map((day) => {
            const c = byDay.get(day.getTime());
            return {
              label: shortDate(day),
              rate: c && c.hasData && team.length ? round1((c.present.size / team.length) * 100) : null,
            };
          }),
        };
      },
    ],
    [
      "h-abs",
      null,
      async () => {
        const [team, cks] = await Promise.all([roster(), checkins()]);
        const recent = cks.filter((c) => c.day >= last8[0] && c.hasData);
        const rows = team
          .map((u) => {
            let missed = 0;
            for (let i = recent.length - 1; i >= 0 && !recent[i].present.has(u.id); i -= 1) missed += 1;
            const last = [...recent].reverse().find((c) => c.present.has(u.id));
            return { u, missed, last: last?.day || null };
          })
          .filter((r) => r.missed >= 2)
          .sort((a, b) => b.missed - a.missed || a.u.name.localeCompare(b.u.name));
        const items: ListItem[] = rows.slice(0, 10).map((r) => ({
          title: r.u.name,
          sub: r.last ? `Last check-in ${shortDate(r.last)}` : `No check-in in the last ${plural(recent.length, "Sunday")}`,
          pill: pill(r.missed >= 3 ? "danger" : "warning", `${r.missed} Sundays`),
          ref_id: r.u.id,
        }));
        return { items, total: rows.length };
      },
    ],
    [
      "h-req",
      ["Requisition", "view"],
      async () => {
        const cutoff = new Date(now.getTime() - 14 * DAY);
        const [reqs, rejected] = await Promise.all([
          deptRequests(),
          // Rejected in the last 14 days (updated_at, else requisition_date).
          prisma.request.count({
            where: {
              department_id: dept.id,
              request_approval_status: RequestApprovalStatus.REJECTED,
              OR: [{ updated_at: { gte: cutoff } }, { updated_at: null, requisition_date: { gte: cutoff } }],
            },
          }),
        ]);
        counts.rejected = rejected;
        const lookups = await loadStepLookups(reqs);
        return { items: reqs.map((r) => requisitionListItem(r, lookups)) };
      },
    ],
    [
      "h-ev",
      null,
      async () => {
        const rows = (await prisma.event_mgt.findMany({
          where: {
            ...eventBranchWhere(deptBranch),
            start_date: { gte: dayStart(now), lt: new Date(dayStart(now).getTime() + 8 * DAY) },
          },
          select: eventSelect,
          orderBy: { start_date: "asc" },
          take: 6,
        })) as EventRow[];
        const items: AgendaItem[] = rows.map((e) => eventAgendaItem(e));
        return { items };
      },
    ],
    [
      "h-pos",
      null,
      async () => {
        const [positions, holders, head] = await Promise.all([
          prisma.position.findMany({
            where: { department_id: dept.id },
            select: { id: true, name: true, user: { select: { id: true, name: true } } },
            orderBy: { name: "asc" },
            take: 12,
          }),
          prisma.department_positions.findMany({
            where: { department_id: dept.id, position_id: { not: null } },
            select: { position_id: true, user: { select: { id: true, name: true } } },
          }),
          prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
        ]);
        const items: ListItem[] = [
          { title: "Head of department", sub: head?.name || "", pill: pill("success", "Filled") },
          ...positions.map((p) => {
            const names = [
              ...new Set([
                ...holders.filter((h) => h.position_id === p.id).map((h) => h.user.name),
                ...p.user.map((u) => u.name),
              ]),
            ];
            return {
              title: p.name,
              sub: names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "") : "No one assigned",
              pill: names.length ? pill("success", "Filled") : pill("danger", "Vacant"),
              ref_id: p.id,
            };
          }),
        ];
        return { items };
      },
    ],
  ];

  /* ---------- department attendance report ---------- */
  const reportConfig = await loadReportConfig().catch(() => null);
  const reportDisabled = !!reportConfig?.dept_attendance.disabled_department_ids.includes(dept.id);
  if (!reportDisabled) {
    core.push([
      "h-rep",
      null,
      async () => {
        const key = deptAttKey(dept.id);
        const curRange = parsePeriod("MONTHLY", monthKey(now));
        const prevRange = parsePeriod("MONTHLY", monthKey(new Date(curRange.from.getTime() - DAY)));
        const dueDay = reportConfig?.dept_attendance.due_day || 5;
        const rows = await prisma.department_reports.findMany({
          where: { report_key: key, period_type: "MONTHLY", period_key: { in: [curRange.key, prevRange.key] }, branch_key: 0 },
          select: { period_key: true, status: true, approved_at: true, returned_at: true, submitted_at: true },
        });
        const curRow = rows.find((r) => r.period_key === curRange.key);
        const prevRow = rows.find((r) => r.period_key === prevRange.key);
        const curDue = dueOnDayAfter(curRange, dueDay);
        const prevDue = dueOnDayAfter(prevRange, dueDay);
        const open = (s: string | undefined) => !s || s === "DRAFT" || s === "RETURNED";
        // The previous month's report is the one due early this month.
        if (open(prevRow?.status) && now <= new Date(prevDue.getTime() + 30 * DAY)) {
          counts.report = 1;
          counts.reportLabel = now > prevDue ? `${prevRange.label.split(" ")[0]} report overdue` : `Report due ${shortDate(prevDue)}`;
        } else if (open(curRow?.status) && curDue.getTime() - now.getTime() <= 14 * DAY) {
          counts.report = 1;
          counts.reportLabel = `Report due ${shortDate(curDue)}`;
        }
        return {
          current: {
            period_label: curRange.label,
            status: curRow?.status ?? "NOT_STARTED",
            due_date: isoDay(curDue),
            key,
            period_key: curRange.key,
          },
          previous: {
            period_label: prevRange.label,
            status: prevRow?.status ?? "NOT_STARTED",
            decided_at: (prevRow?.approved_at || prevRow?.returned_at)?.toISOString() ?? null,
            due_date: isoDay(prevDue),
            period_key: prevRange.key,
          },
        };
      },
    ]);
  }

  /* ---------- department packs ---------- */
  const assetsWidget = (id: string): Entries[number] => [
    id,
    ["Asset", "view"],
    async () => {
      const rows = await prisma.assets.findMany({
        where: { department_assigned: dept.id },
        select: {
          id: true,
          name: true,
          status: true,
          date_assigned: true,
          status_since: true,
          repair_request_id: true,
          repair_request: { select: { request_approval_status: true } },
        },
        take: 100,
      });
      const rank = (s: string | null) => (s === "NEEDS_REPAIR" ? 0 : s === "LOST_OR_STOLEN" ? 1 : s === "ASSIGNED" ? 3 : 2);
      const needsRepair = rows.filter((a) => a.status === "NEEDS_REPAIR");
      // Children pack's "Needs you" item: assets needing repair with no requisition raised.
      if (id === "k-ast") counts.pack = needsRepair.filter((a) => !a.repair_request_id).length;
      const items: ListItem[] = rows
        .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name))
        .slice(0, 6)
        .map((a) => {
          const since = a.status_since || a.date_assigned;
          const sub =
            a.status === "NEEDS_REPAIR"
              ? a.repair_request
                ? a.repair_request.request_approval_status === RequestApprovalStatus.APPROVED ||
                  a.repair_request.request_approval_status === RequestApprovalStatus.DISBURSED
                  ? "Repair requisition approved"
                  : isPendingRequisition(a.repair_request.request_approval_status)
                    ? "Repair requisition awaiting approval"
                    : "Repair requisition not approved"
                : "No repair requisition yet"
              : since
                ? `Since ${monthYear(since)}`
                : "";
          const tone = a.status === "ASSIGNED" ? "success" : a.status === "NEEDS_REPAIR" ? "warning" : a.status === "LOST_OR_STOLEN" || a.status === "NOT_FIXABLE" ? "danger" : "neutral";
          return { title: a.name, sub, pill: a.status ? pill(tone, ASSET_LABEL[a.status] || a.status) : null, ref_id: a.id };
        });
      return { items, total: rows.length, needs_repair: needsRepair.length };
    },
  ];

  const packWidgets: Entries = [];
  if (pack === "media") {
    packWidgets.push(assetsWidget("m-ast"), [
      "m-ser",
      ["Sermons", "view"],
      async () => {
        // Drafts are listed to publish them, so only for Sermons.publish.
        if (!(await ctx.action("Sermons", "publish"))) {
          counts.pack = 0;
          return { items: [] as QueueItem[] };
        }
        const rows = await prisma.sermon.findMany({
          where: { status: "DRAFT", ...(deptBranch ? { OR: [{ branch_id: deptBranch }, { branch_id: null }] } : getBranchScopedWhere(ctx.branchId) || {}) },
          select: { id: true, title: true, preached_at: true, created_at: true, series: { select: { title: true } } },
          orderBy: [{ preached_at: "desc" }, { created_at: "desc" }],
          take: 10,
        });
        counts.pack = rows.length;
        const items: QueueItem[] = rows.map((s) => ({
          id: `sermon:${s.id}`,
          kind: "sermon",
          ref_id: s.id,
          title: `“${s.title}”`,
          sub: [s.preached_at ? shortDate(s.preached_at) : "No date", s.series?.title || null, "draft"].filter(Boolean).join(" · "),
          pill: null,
        }));
        return { items };
      },
    ]);
  } else if (pack === "evangelism") {
    const visitorBranch = deptBranch ? { branch_id: deptBranch } : getBranchScopedWhere(ctx.branchId) || {};
    packWidgets.push(
      [
        "e-g",
        ["Visitors", "view"],
        async () => {
          if (!(await ctx.action("Visitors", "record_follow_up"))) {
            counts.pack = 0;
            return { items: [] as QueueItem[], total: 0 };
          }
          const team = await roster();
          const teamIds = new Set(team.map((u) => u.id));
          const names = new Map(team.map((u) => [u.id, u.name]));
          const visitors = await prisma.visitor.findMany({
            where: { ...visitorBranch, is_member: false, visitDate: { gte: new Date(now.getTime() - 60 * DAY) } },
            select: {
              id: true,
              title: true,
              firstName: true,
              lastName: true,
              visitDate: true,
              responsibleMembers: true,
              followUps: { select: { id: true, status: true, assignedTo: true, date: true }, orderBy: { date: "desc" } },
              _count: { select: { visits: true } },
            },
            orderBy: { visitDate: "desc" },
            take: 300,
          });
          const mine = visitors
            .map((v) => {
              const responsible = [
                ...parseIds(v.responsibleMembers),
                ...v.followUps.map((f) => f.assignedTo).filter((x): x is number => !!x),
              ].filter((id) => teamIds.has(id));
              return { v, responsible };
            })
            .filter((x) => x.responsible.length && !x.v.followUps.some((f) => isDone(f.status)));
          counts.pack = mine.length;
          const items: QueueItem[] = mine.slice(0, 8).map(({ v, responsible }) => {
            const who = responsible.includes(ctx.userId) ? "you are responsible" : `${names.get(responsible[0])} responsible`;
            const notContacted = v.followUps.length === 0;
            return {
              id: `follow_up:${v.id}`,
              kind: "follow_up",
              ref_id: v.id,
              title: visitorName(v),
              sub: [`Visited ${shortDate(v.visitDate)}`, v._count.visits > 1 ? `visit ${v._count.visits}` : null, who]
                .filter(Boolean)
                .join(" · "),
              pill: notContacted ? pill("danger", "Not contacted") : pill("neutral", "Follow-up pending"),
              // The open follow-up to complete, so recording one doesn't leave it pending.
              follow_up_id: v.followUps[0]?.id ?? null,
            };
          });
          return { items, total: mine.length };
        },
      ],
      [
        "e-s",
        ["Visitors", "view"],
        async () => {
          const visitors = await prisma.visitor.findMany({
            where: { ...visitorBranch, visitDate: { gte: ctx.range.from, lte: ctx.range.to } },
            select: { followUps: { select: { status: true } } },
          });
          const followed = visitors.filter((v) => v.followUps.some((f) => isDone(f.status))).length;
          const none = visitors.filter((v) => !v.followUps.length).length;
          return {
            visitors: visitors.length,
            followed_up: followed,
            pending: visitors.length - followed - none,
            not_contacted: none,
          };
        },
      ],
      [
        "e-f",
        ["Life Center", "view"],
        async () => {
          const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
          const lcWhere = deptBranch ? { lifeCenter: { is: { branch_id: deptBranch } } } : {};
          const where = { ...lcWhere, date_won: { gte: yearStart, lte: now } };
          const [won, attended, members] = await Promise.all([
            prisma.soul_won.count({ where }),
            prisma.soul_won.count({ where: { ...where, life_center_meeting_attendee: { some: {} } } }),
            prisma.soul_won.count({ where: { ...where, memberId: { not: null } } }),
          ]);
          return {
            steps: [
              { label: "Souls won", value: won },
              { label: "Attended a meeting", value: attended },
              { label: "Became members", value: members },
            ],
            pct: pctOf(members, won),
          };
        },
      ],
    );
  } else if (pack === "children") {
    packWidgets.push(assetsWidget("k-ast"), [
      "k-ev",
      null,
      async () => {
        const rows = (await prisma.event_mgt.findMany({
          where: {
            ...eventBranchWhere(deptBranch),
            start_date: { gte: dayStart(now), lt: new Date(now.getTime() + 60 * DAY) },
            event: { is: { OR: [{ event_name: { contains: "child" } }, { event_name: { contains: "kid" } }] } },
          },
          select: eventSelect,
          orderBy: { start_date: "asc" },
          take: 5,
        })) as EventRow[];
        return { items: rows.map((e) => eventAgendaItem(e, { showNoRegistration: true })) };
      },
    ]);
  }

  const widgets = await runWidgets(ctx, [...core, ...packWidgets]);

  const packWidget = pack === "media" ? "m-ser" : pack === "evangelism" ? "e-g" : pack === "children" ? "k-ast" : "";
  const packLabel =
    pack === "media" ? "Sermon drafts" : pack === "evangelism" ? "Follow-ups to record" : "Assets needing repair";
  const needs: NeedsItem[] = [
    { key: "h-join", label: "Join requests", count: counts.joins, widget: "h-join" },
    {
      key: "h-req",
      label: counts.rejected === 1 ? "Requisition rejected" : "Requisitions rejected",
      count: counts.rejected,
      widget: "h-req",
    },
    { key: "h-rep", label: counts.reportLabel || "Department report", count: counts.report, widget: "h-rep" },
    ...(packWidget ? [{ key: "h-pack", label: packLabel, count: counts.pack, widget: packWidget }] : []),
  ];
  return { needs, widgets, departments };
};
