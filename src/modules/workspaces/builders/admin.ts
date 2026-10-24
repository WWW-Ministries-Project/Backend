/**
 * Admin workspace: "Is everything running?"
 */
import { Prisma, RequestApprovalStatus, RequisitionApprovalInstanceStatus } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScope } from "../../branches/branchScope";
import { addDays, utc } from "../../departmentReports/period";
import { upcomingEvents as rideEvents } from "../../rides/rideService";
import { loadReportConfig } from "../../settings/reportConfigService";
import {
  DAY_MS,
  DEPT_ATT_PREFIX,
  branchWhere,
  dayStart,
  isoDay,
  loadStepNames,
  once,
  pendingJoinRequests,
  recentVisitors,
  requisitionConfig,
  requisitionTotal,
  requisitionsAtMyStep,
  stepLabel,
  unassignedVisitorQueue,
  visibleBranches,
} from "../queries/prelateAdmin";
import type { NeedsItem, QueueItem, WorkspaceBuilder, WorkspaceContext } from "../types";
import { runWidgets } from "../widgetKit";

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const RAG_MAX_ROWS = 12;
const EV_UPCOMING = 5;
const EV_PAST = 4;

type RagCell = "ok" | "sub" | "ret" | "miss" | null;

export const buildAdmin: WorkspaceBuilder = async (ctx) => {
  const [canVisitorsManage, canRides, canMarket] = await Promise.all([
    ctx.can("Visitors", "manage"),
    // Ride office overview is for Membership_Management managers (rides RIDE_SAFETY_DOMAIN).
    ctx.can("Membership_Management", "manage"),
    ctx.can("Marketplace", "view"),
  ]);

  const requisitions = once(() => requisitionsAtMyStep(ctx));
  const joins = once(() => pendingJoinRequests(ctx));
  const visitorQueue = once(async () =>
    canVisitorsManage ? unassignedVisitorQueue(await recentVisitors(ctx)) : { total: 0, items: [] as QueueItem[] },
  );
  const rag = once(() => reportGrid(ctx));

  const entries: Parameters<typeof runWidgets>[1] = [
    [
      "a-q",
      null,
      async () => {
        const [req, join, vis] = await Promise.all([requisitions(), joins(), visitorQueue()]);
        return { items: [...req.items, ...join.items, ...vis.items] };
      },
    ],
    ["a-rag", ["Reports", "view"], async () => (await rag()).data],
    ["a-kan", ["Requisition", "view"], () => requisitionPipeline(ctx)],
    ["a-ev", ["Events", "view"], () => eventRows(ctx)],
    ["a-dep", ["Departments", "view"], () => departmentRows(ctx)],
    ["a-ast", ["Asset", "view"], () => assetStats(ctx)],
    ["a-com", ["Messaging", "view"], () => communication(ctx)],
  ];
  if (canRides || canMarket) {
    entries.push(["a-log", null, () => logistics(ctx, canRides, canMarket)]);
  }

  const widgets = await runWidgets(ctx, entries);

  const needs: NeedsItem[] = [];
  if ("a-q" in widgets) {
    const [req, join, vis] = await Promise.all([
      requisitions().catch(() => ({ total: 0 })),
      joins().catch(() => ({ total: 0 })),
      visitorQueue().catch(() => ({ total: 0 })),
    ]);
    needs.push(
      { key: "a-req", label: "Requisitions", count: req.total, widget: "a-q", tab: "requisition" },
      { key: "a-join", label: "Join requests", count: join.total, widget: "a-q", tab: "join_request" },
      { key: "a-vis", label: "Visitors to assign", count: vis.total, widget: "a-q", tab: "visitor" },
    );
  }
  if ("a-rag" in widgets) {
    const missing = await rag()
      .then((r) => r.missing)
      .catch(() => 0);
    needs.push({ key: "a-rag", label: "Reports not submitted", count: missing, widget: "a-rag" });
  }

  return { needs, widgets };
};

/* -------------------------------------------------------------------------- */
/*                         a-rag: department reports                           */
/* -------------------------------------------------------------------------- */

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Department attendance reports (`dept_att:<id>`, MONTHLY) by department.
 * All branches: columns are branches for last month, rows are department
 * names (a name used in several branches shares a row). One branch: columns
 * are the last 4 completed months. A report still in draft (or never
 * started) counts as missing once its due day has passed; before that the
 * cell is null.
 */
const reportGrid = async (ctx: WorkspaceContext) => {
  const now = new Date();
  const thisMonth = utc(now.getUTCFullYear(), now.getUTCMonth());
  const months = (ctx.branchId ? [4, 3, 2, 1] : [1]).map((back) =>
    utc(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - back),
  );
  const [branches, config] = await Promise.all([
    ctx.branchId ? Promise.resolve([]) : visibleBranches(),
    loadReportConfig(),
  ]);
  const { due_day: dueDay, disabled_department_ids: disabled } = config.dept_attendance;
  const departments = await prisma.department.findMany({
    where: { ...branchWhere(ctx), ...(disabled.length ? { id: { notIn: disabled } } : {}) },
    select: { id: true, name: true, branch_id: true },
    orderBy: { name: "asc" },
  });
  const rows = departments.length
    ? await prisma.department_reports.findMany({
        where: {
          report_key: { in: departments.map((d) => `${DEPT_ATT_PREFIX}${d.id}`) },
          period_type: "MONTHLY",
          period_key: { in: months.map(monthKey) },
        },
        select: { report_key: true, period_key: true, status: true },
      })
    : [];
  const status = new Map(rows.map((r) => [`${r.report_key}|${r.period_key}`, r.status]));
  const cellFor = (deptId: number, month: Date): RagCell => {
    const s = status.get(`${DEPT_ATT_PREFIX}${deptId}|${monthKey(month)}`);
    if (s === "APPROVED") return "ok";
    if (s === "SUBMITTED") return "sub";
    if (s === "RETURNED") return "ret";
    const due = utc(month.getUTCFullYear(), month.getUTCMonth() + 1, dueDay + 1); // end of due day
    return now >= due ? "miss" : null;
  };

  let columns: string[];
  let grid: { department: string; cells: RagCell[] }[];
  if (ctx.branchId || branches.length <= 1) {
    columns = months.map((m) => MONTHS_LONG[m.getUTCMonth()]);
    grid = departments.map((d) => ({ department: d.name, cells: months.map((m) => cellFor(d.id, m)) }));
  } else {
    columns = branches.map((b) => b.name);
    const byName = new Map<string, { department: string; ids: Map<number, number> }>();
    departments.forEach((d) => {
      const key = d.name.trim().toLowerCase();
      const row = byName.get(key) || { department: d.name.trim(), ids: new Map<number, number>() };
      if (d.branch_id != null && !row.ids.has(d.branch_id)) row.ids.set(d.branch_id, d.id);
      byName.set(key, row);
    });
    grid = Array.from(byName.values()).map((r) => ({
      department: r.department,
      cells: branches.map((b) => (r.ids.has(b.id) ? cellFor(r.ids.get(b.id) as number, months[0]) : null)),
    }));
  }
  const missing = grid.reduce((s, r) => s + r.cells.filter((c) => c === "miss").length, 0);
  // Rows needing attention first, then alphabetical; bounded for the card.
  const weight = (r: { cells: RagCell[] }) => r.cells.filter((c) => c === "miss" || c === "ret").length;
  grid.sort((a, b) => weight(b) - weight(a) || a.department.localeCompare(b.department));
  return { data: { columns, rows: grid.slice(0, RAG_MAX_ROWS) }, missing };
};

/* -------------------------------------------------------------------------- */
/*                        a-kan: requisitions in approval                      */
/* -------------------------------------------------------------------------- */

/**
 * Open requisitions by where they sit: Draft, each approval step (from the
 * pending approval instance), and Approved in the selected range. `overdue`
 * counts requisitions that have waited at their step longer than the
 * configured reply time.
 */
const requisitionPipeline = async (ctx: WorkspaceContext) => {
  const scope = branchWhere(ctx) as Prisma.requestWhereInput;
  const { from, to } = ctx.range;
  const draftWhere: Prisma.requestWhereInput = { ...scope, request_approval_status: RequestApprovalStatus.Draft };
  const approvedWhere: Prisma.requestWhereInput = {
    ...scope,
    request_approval_status: RequestApprovalStatus.APPROVED,
    OR: [
      { approval_instances: { some: { status: RequisitionApprovalInstanceStatus.APPROVED, acted_at: { gte: from, lte: to } } } },
      { approval_instances: { none: {} }, request_approvals: { is: { ps_approval_date: { gte: from, lte: to } } } },
    ],
  };
  // Count in SQL; the value (items x unit price, rounded per requisition) from item rows only.
  const valueOf = async (where: Prisma.requestWhereInput) => {
    const items = await prisma.requested_item.findMany({
      where: { request: where },
      select: { request_id: true, unitPrice: true, quantity: true },
    });
    const byRequest = new Map<number, { unitPrice: number; quantity: number }[]>();
    items.forEach((i) => {
      const list = byRequest.get(i.request_id);
      if (list) list.push(i);
      else byRequest.set(i.request_id, [i]);
    });
    return Array.from(byRequest.values()).reduce((s, list) => s + requisitionTotal(list), 0);
  };
  const [config, draftCount, draftValue, pending, approvedCount, approvedValue] = await Promise.all([
    requisitionConfig(),
    prisma.request.count({ where: draftWhere }),
    valueOf(draftWhere),
    prisma.request.findMany({
      where: {
        ...scope,
        request_approval_status: {
          in: [RequestApprovalStatus.Awaiting_HOD_Approval, RequestApprovalStatus.Awaiting_Executive_Pastor_Approval],
        },
      },
      select: {
        request_approval_status: true,
        submitted_at: true,
        requisition_date: true,
        products: { select: { unitPrice: true, quantity: true } },
        approval_instances: {
          orderBy: { step_order: "asc" },
          select: { step_order: true, step_type: true, approver_user_id: true, position_id: true, status: true, acted_at: true },
        },
      },
    }),
    prisma.request.count({ where: approvedWhere }),
    valueOf(approvedWhere),
  ]);

  const names = await loadStepNames(
    [
      ...config.steps.map((s) => s.user_id).filter((id): id is number => Boolean(id)),
      ...pending.flatMap((r) => r.approval_instances.map((i) => i.approver_user_id)),
    ],
    [
      ...config.steps.map((s) => s.position_id).filter((id): id is number => Boolean(id)),
      ...pending.flatMap((r) => r.approval_instances.map((i) => i.position_id).filter((id): id is number => Boolean(id))),
    ],
  );

  type Col = { label: string; count: number; amount: number; overdue: number };
  const stepCols = new Map<string, Col>();
  const colFor = (key: string, label: string) => {
    const col = stepCols.get(key) || { label, count: 0, amount: 0, overdue: 0 };
    stepCols.set(key, col);
    return col;
  };
  // Configured steps first, in order, so empty steps still show.
  config.steps.forEach((s) => {
    const user = s.user_id ? names.users.get(s.user_id) : null;
    colFor(
      `s${s.step_order}`,
      stepLabel(s.step_type, s.position_id ? names.positions.get(s.position_id) : null, user?.position ?? user?.name),
    );
  });

  const now = new Date();
  pending.forEach((r) => {
    const amount = requisitionTotal(r.products);
    const idx = r.approval_instances.findIndex((i) => i.status === RequisitionApprovalInstanceStatus.PENDING);
    let col: Col;
    let since: Date = r.submitted_at ?? r.requisition_date;
    if (idx >= 0) {
      const inst = r.approval_instances[idx];
      const approver = names.users.get(inst.approver_user_id);
      col = colFor(
        `s${inst.step_order}`,
        stepLabel(inst.step_type, inst.position_id ? names.positions.get(inst.position_id) : null, approver?.position),
      );
      if (idx > 0 && r.approval_instances[idx - 1].acted_at) since = r.approval_instances[idx - 1].acted_at as Date;
    } else {
      // Legacy two-step flow without approval instances.
      col =
        r.request_approval_status === RequestApprovalStatus.Awaiting_HOD_Approval
          ? colFor("legacy-hod", "Head of department")
          : colFor("legacy-ep", "Executive pastor");
    }
    col.count += 1;
    col.amount += amount;
    if (now.getTime() - since.getTime() > config.replyDays * DAY_MS) col.overdue += 1;
  });

  const round = (n: number) => Math.round(n * 100) / 100;
  const steps = [
    {
      label: "Draft",
      count: draftCount,
      amount: round(draftValue),
      overdue: 0,
    },
    ...Array.from(stepCols.values()).map((c) => ({ ...c, amount: round(c.amount) })),
    {
      label: "Approved",
      count: approvedCount,
      amount: round(approvedValue),
      overdue: 0,
    },
  ];
  return { steps };
};

/* -------------------------------------------------------------------------- */
/*                               a-ev: events                                  */
/* -------------------------------------------------------------------------- */

const REPORT_STATE: Record<string, "draft" | "submitted" | "approved"> = {
  DRAFT: "draft",
  REJECTED: "draft",
  PENDING_FINAL: "submitted",
  APPROVED: "approved",
};

/** Next 14 days, plus events of the last 7 days with their event-report state. */
const eventRows = async (ctx: WorkspaceContext) => {
  const today = dayStart(new Date());
  const select = {
    id: true,
    start_date: true,
    requires_registration: true,
    registration_capacity: true,
    event: { select: { event_name: true } },
    _count: { select: { event_registers: true } },
  } satisfies Prisma.event_mgtSelect;
  const scope = branchWhere(ctx) as Prisma.event_mgtWhereInput;
  const [upcoming, past] = await Promise.all([
    prisma.event_mgt.findMany({
      where: { ...scope, start_date: { gte: today, lt: addDays(today, 15) } },
      orderBy: [{ start_date: "asc" }, { id: "asc" }],
      take: EV_UPCOMING,
      select,
    }),
    prisma.event_mgt.findMany({
      where: { ...scope, start_date: { gte: addDays(today, -7), lt: today } },
      orderBy: [{ start_date: "desc" }, { id: "desc" }],
      take: EV_PAST,
      select,
    }),
  ]);
  const reports = past.length
    ? await prisma.event_reports.findMany({
        where: { event_id: { in: past.map((e) => e.id) } },
        select: { event_id: true, event_date: true, status: true },
      })
    : [];
  const reportOf = (e: (typeof past)[number]) => {
    const day = e.start_date ? isoDay(e.start_date) : null;
    const r =
      reports.find((x) => x.event_id === e.id && isoDay(x.event_date) === day) ??
      reports.find((x) => x.event_id === e.id);
    return r ? REPORT_STATE[r.status] ?? "draft" : "none";
  };
  const row = (e: (typeof past)[number], isPast: boolean) => ({
    id: e.id,
    title: e.event?.event_name || "Event",
    date: e.start_date ? e.start_date.toISOString() : null,
    registered: e.requires_registration ? e._count.event_registers : null,
    capacity: e.requires_registration ? e.registration_capacity ?? null : null,
    report: isPast ? reportOf(e) : null,
    past: isPast,
  });
  return {
    rows: [...upcoming.map((e) => row(e, false)), ...past.reverse().map((e) => row(e, true))],
  };
};

/* -------------------------------------------------------------------------- */
/*                             a-dep: departments                              */
/* -------------------------------------------------------------------------- */

/** Members counted as the departments list does: department_id or a department position. */
const departmentRows = async (ctx: WorkspaceContext) => {
  const departments = await prisma.department.findMany({
    where: branchWhere(ctx),
    select: { id: true, name: true, department_head_info: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const ids = departments.map((d) => d.id);
  if (!ids.length) return { rows: [] };
  const [users, requests] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [{ department_id: { in: ids } }, { department_positions: { some: { department_id: { in: ids } } } }],
      },
      select: { id: true, department_id: true, department_positions: { select: { department_id: true } } },
    }),
    prisma.department_join_request.groupBy({
      by: ["department_id"],
      where: { status: "PENDING", department_id: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const members = new Map<number, Set<number>>();
  users.forEach((u) => {
    const set = new Set<number>();
    if (u.department_id != null) set.add(u.department_id);
    u.department_positions.forEach((p) => set.add(p.department_id));
    set.forEach((d) => {
      const m = members.get(d) || new Set<number>();
      m.add(u.id);
      members.set(d, m);
    });
  });
  const pending = new Map(requests.map((r) => [r.department_id, r._count._all]));
  const rows = departments
    .map((d) => ({
      id: d.id,
      name: d.name,
      members: members.get(d.id)?.size ?? 0,
      requests: pending.get(d.id) ?? 0,
      head: d.department_head_info?.name ?? null,
    }))
    // Departments needing attention (requests waiting, no head) first.
    .sort(
      (a, b) =>
        b.requests - a.requests || Number(a.head !== null) - Number(b.head !== null) || a.name.localeCompare(b.name),
    )
    .slice(0, 8);
  return { rows };
};

/* -------------------------------------------------------------------------- */
/*                                a-ast: assets                                */
/* -------------------------------------------------------------------------- */

const assetStats = async (ctx: WorkspaceContext) => {
  const scope = branchWhere(ctx) as Prisma.assetsWhereInput;
  const [needsRepair, withoutReq, lost, lastLost, check] = await Promise.all([
    prisma.assets.count({ where: { ...scope, status: "NEEDS_REPAIR" } }),
    prisma.assets.count({ where: { ...scope, status: "NEEDS_REPAIR", repair_request_id: null } }),
    prisma.assets.count({ where: { ...scope, status: "LOST_OR_STOLEN" } }),
    prisma.assets.findFirst({
      where: { ...scope, status: "LOST_OR_STOLEN" },
      orderBy: [{ status_since: "desc" }, { updated_at: "desc" }],
      select: { status_since: true, lost_confirmed_at: true, updated_at: true },
    }),
    prisma.asset_stock_check.findFirst({
      where: { ...(branchWhere(ctx) as Prisma.asset_stock_checkWhereInput), status: "OPEN" },
      orderBy: { due_date: "asc" },
      select: { due_date: true },
    }),
  ]);
  const lostAt = lastLost ? lastLost.status_since ?? lastLost.lost_confirmed_at ?? lastLost.updated_at : null;
  return {
    needs_repair: needsRepair,
    needs_repair_without_req: withoutReq,
    lost,
    last_lost_at: lostAt ? lostAt.toISOString() : null,
    stock_check_due: check?.due_date ? check.due_date.toISOString() : null,
  };
};

/* -------------------------------------------------------------------------- */
/*                            a-com: communication                             */
/* -------------------------------------------------------------------------- */

/**
 * Messages sent in the range (recipient rows, every channel). Messaging is
 * church-wide (dispatches have no branch), so these figures ignore the branch.
 * `delivered_pct` = sent / (sent + failed): providers report hand-off, not
 * handset delivery. Promotions live = published and inside their dates.
 */
const communication = async (ctx: WorkspaceContext) => {
  const { from, to } = ctx.range;
  const now = new Date();
  const allowed = getBranchScope()?.allowedBranchIds ?? null;
  const promoBranch: Prisma.promotionWhereInput = ctx.branchId
    ? { OR: [{ branch_id: ctx.branchId }, { branch_id: null }] }
    : allowed
      ? { OR: [{ branch_id: { in: allowed } }, { branch_id: null }] }
      : {};
  const [sent, failed, promotions, canPromos] = await Promise.all([
    prisma.message_recipient.count({ where: { status: "SENT", sent_at: { gte: from, lte: to } } }),
    prisma.message_recipient.count({ where: { status: "FAILED", created_at: { gte: from, lte: to } } }),
    prisma.promotion.count({
      where: {
        AND: [
          { status: "PUBLISHED" },
          { OR: [{ start_date: null }, { start_date: { lte: now } }] },
          { OR: [{ end_date: null }, { end_date: { gte: now } }] },
          promoBranch,
        ],
      },
    }),
    ctx.can("Promotions", "view"),
  ]);
  return {
    sent,
    delivered_pct: sent + failed ? Math.round((sent / (sent + failed)) * 1000) / 10 : null,
    promotions_live: canPromos ? promotions : null,
  };
};

/* -------------------------------------------------------------------------- */
/*                          a-log: rides and orders                            */
/* -------------------------------------------------------------------------- */

/**
 * Rides for the soonest upcoming event day (as the ride office overview
 * picks it), and paid marketplace orders still to hand over. Fields the
 * caller can't see are null.
 */
const logistics = async (ctx: WorkspaceContext, canRides: boolean, canMarket: boolean) => {
  let next_service: string | null = null;
  let ride_requests: number | null = null;
  let seats_offered: number | null = null;
  let unmatched: number | null = null;
  let orders_to_fulfil: number | null = null;

  if (canRides) {
    const events = await rideEvents();
    const day = events[0]?.day ?? null;
    next_service = day ? isoDay(day) : null;
    if (day) {
      const offers = await prisma.ride_offer.findMany({
        where: {
          service_date: day,
          status: "ACTIVE",
          ...(ctx.branchId || getBranchScope()?.allowedBranchIds
            ? { event: { is: branchWhere(ctx) as Prisma.event_mgtWhereInput } }
            : {}),
        },
        select: { seats_total: true, requests: { select: { status: true } } },
      });
      seats_offered = offers.reduce((s, o) => s + o.seats_total, 0);
      const reqs = offers.flatMap((o) => o.requests);
      ride_requests = reqs.filter((r) => r.status === "PENDING" || r.status === "ACCEPTED").length;
      unmatched = reqs.filter((r) => r.status === "PENDING").length;
    } else {
      seats_offered = 0;
      ride_requests = 0;
      unmatched = 0;
    }
  }
  if (canMarket) {
    orders_to_fulfil = await prisma.orders.count({
      where: { deleted_at: null, payment_status: "success", delivery_status: { in: ["pending", "shipped"] } },
    });
  }
  return { next_service, ride_requests, seats_offered, unmatched, orders_to_fulfil };
};
