/**
 * Shared reads for the prelate and admin workspaces: report-aggregator reuse,
 * approval queues (requisitions, department reports, appointments, join
 * requests, visitors) and the recent-visitor follow-up picture.
 *
 * Everything here only reads. Queue actions go through the existing module
 * endpoints with each item's `ref_id`.
 */
import {
  Prisma,
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  RequisitionApprovalModule,
  RequisitionApproverType,
} from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScope } from "../../branches/branchScope";
import { getBranchScopedWhere } from "../../branches/branchService";
import { DEFAULT_APPROVAL_REPLY_DAYS } from "../../requisitions/requisition-approval-workflow";
import { addDays, longDate, parsePeriod, shortDate } from "../../departmentReports/period";
import { REPORT_MAP } from "../../departmentReports/registry";
import { nf } from "../../departmentReports/sections";
import { loadReportConfig } from "../../settings/reportConfigService";
import type { KpiDTO, PeriodType, ReportResult } from "../../departmentReports/types";
import type { Kpi, QueueItem, WorkspaceContext } from "../types";
import { deltaPct } from "../widgetKit";

export const DAY_MS = 86_400_000;
export const QUEUE_LIMIT = 6;
export const FOLLOW_UP_WINDOW_DAYS = 30;
export const DEPT_ATT_PREFIX = "dept_att:";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dayLabel = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${shortDate(d)}`;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysSince = (d: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS));
export const plural = (n: number, one: string, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;

/** Memoises an async read for the life of one workspace request. */
export const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) p = fn();
    return p;
  };
};

/** Branches the caller may see (all when unrestricted), default branch first. */
export const visibleBranches = async () => {
  const allowed = getBranchScope()?.allowedBranchIds ?? null;
  return prisma.branch.findMany({
    where: allowed ? { id: { in: allowed } } : undefined,
    select: { id: true, name: true },
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
  });
};

/** `where` fragment for a model's own branch column ({} = no filter). */
export const branchWhere = (ctx: WorkspaceContext, field = "branch_id") =>
  (getBranchScopedWhere(ctx.branchId, field) ?? {}) as Record<string, any>;

/* -------------------------------------------------------------------------- */
/*                        Department report aggregators                        */
/* -------------------------------------------------------------------------- */

export const PERIOD_TYPE: Record<WorkspaceContext["range"]["key"], PeriodType> = {
  WEEK: "WEEKLY",
  MONTH: "MONTHLY",
  QUARTER: "QUARTERLY",
  YEAR: "ANNUAL",
};

export const findKpi = (result: ReportResult | null, key: string) =>
  result?.body.kpis.find((k) => k.key === key) ?? null;

/** Department-report KPI → workspace KPI (delta against the previous period). */
export const toKpi = (k: KpiDTO | null, key: string, label: string, extra: Partial<Kpi> = {}): Kpi => {
  const value = k?.value ?? null;
  const prev = k?.compare.prev ?? null;
  const points = Boolean(k?.points);
  const format: Kpi["format"] =
    k && ["n", "pct", "ghs", "signed", "raw"].includes(k.format) ? (k.format as Kpi["format"]) : "n";
  return {
    key,
    label,
    value,
    format,
    delta_pct:
      points && value != null && prev != null ? Math.round((value - prev) * 10) / 10 : deltaPct(value, prev),
    ...(points ? { points: true } : {}),
    good: k?.good ?? "up",
    spark: k?.spark ?? [],
    ...(k?.sub ? { sub: k.sub } : {}),
    ...extra,
  };
};

/* -------------------------------------------------------------------------- */
/*                                Requisitions                                */
/* -------------------------------------------------------------------------- */

const PENDING_REQUEST_STATUSES = [
  RequestApprovalStatus.Awaiting_HOD_Approval,
  RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
];

export const requisitionTotal = (items: { unitPrice: number; quantity: number }[]) =>
  Math.round(items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0), 0) * 100) / 100;

const requisitionTitle = (request_id: string, items: { name: string }[]) => {
  if (!items.length) return `Requisition ${request_id}`;
  if (items.length === 1) return items[0].name;
  return `${items[0].name} and ${plural(items.length - 1, "more item")}`;
};

export const requisitionConfig = async () => {
  const config = await prisma.requisition_approval_configs
    .findUnique({
      where: { module: RequisitionApprovalModule.REQUISITION },
      select: {
        approval_reply_days: true,
        steps: {
          orderBy: { step_order: "asc" },
          select: { step_order: true, step_type: true, position_id: true, user_id: true },
        },
      },
    })
    .catch(() => null);
  return {
    replyDays: config?.approval_reply_days || DEFAULT_APPROVAL_REPLY_DAYS,
    steps: config?.steps ?? [],
  };
};

/** Same labels as the requisitions overview (requisition-redesign stepLabel). */
export const stepLabel = (
  type: RequisitionApproverType,
  positionName: string | null | undefined,
  approverPosition: string | null | undefined,
) => {
  if (type === RequisitionApproverType.HEAD_OF_DEPARTMENT) return "Head of department";
  if (type === RequisitionApproverType.POSITION) return positionName || "Approver";
  return approverPosition || "Approver";
};

export const loadStepNames = async (userIds: number[], positionIds: number[]) => {
  const [users, positions] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: Array.from(new Set(userIds)) } },
          select: { id: true, name: true, position: { select: { name: true } } },
        })
      : Promise.resolve([]),
    positionIds.length
      ? prisma.position.findMany({ where: { id: { in: Array.from(new Set(positionIds)) } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    users: new Map(users.map((u) => [u.id, { name: u.name, position: u.position?.name ?? null }])),
    positions: new Map(positions.map((p) => [p.id, p.name])),
  };
};

/** Requisitions whose current (PENDING) approval step is the caller's. */
export const requisitionsAtMyStep = async (ctx: WorkspaceContext, limit = QUEUE_LIMIT) => {
  const where: Prisma.requestWhereInput = {
    ...branchWhere(ctx),
    request_approval_status: { in: PENDING_REQUEST_STATUSES },
    approval_instances: {
      some: { approver_user_id: ctx.userId, status: RequisitionApprovalInstanceStatus.PENDING },
    },
  };
  const [total, rows, { replyDays }] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: [{ submitted_at: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        request_id: true,
        purpose: true,
        needed_by: true,
        submitted_at: true,
        requisition_date: true,
        user: { select: { name: true } },
        department: { select: { name: true } },
        products: { select: { name: true, unitPrice: true, quantity: true } },
        approval_instances: {
          orderBy: { step_order: "asc" },
          select: { step_order: true, step_type: true, approver_user_id: true, position_id: true, status: true, acted_at: true },
        },
      },
    }),
    requisitionConfig(),
  ]);

  const names = await loadStepNames(
    rows.flatMap((r) => r.approval_instances.map((i) => i.approver_user_id)),
    rows.flatMap((r) => r.approval_instances.map((i) => i.position_id).filter((id): id is number => Boolean(id))),
  );
  const now = new Date();

  const items: QueueItem[] = rows.map((r) => {
    const raised = r.submitted_at ?? r.requisition_date;
    const curIndex = r.approval_instances.findIndex((i) => i.status === RequisitionApprovalInstanceStatus.PENDING);
    const since = (curIndex > 0 ? r.approval_instances[curIndex - 1].acted_at : null) ?? raised;
    const waited = daysSince(since, now);
    const amount = requisitionTotal(r.products);
    const steps = r.approval_instances.map((i) => {
      const approver = names.users.get(i.approver_user_id);
      const state: "ok" | "cur" | "wait" =
        i.status === RequisitionApprovalInstanceStatus.APPROVED
          ? "ok"
          : i.status === RequisitionApprovalInstanceStatus.PENDING
            ? "cur"
            : "wait";
      return {
        label: stepLabel(i.step_type, i.position_id ? names.positions.get(i.position_id) : null, approver?.position),
        who: i.approver_user_id === ctx.userId ? "You" : approver?.name || "Unknown approver",
        state,
        ...(state === "ok" && i.acted_at
          ? { when: shortDate(i.acted_at) }
          : state === "cur"
            ? { when: waited === 0 ? "Today" : plural(waited, "day") }
            : {}),
      };
    });
    const fields: [string, string][] = [
      ["Requisition", r.request_id],
      ["Department", r.department?.name || "—"],
      ["Raised by", r.user?.name || "—"],
      ["Raised on", longDate(raised)],
    ];
    if (r.needed_by) fields.push(["Needed by", longDate(r.needed_by)]);
    return {
      id: `req-${r.id}`,
      kind: "requisition",
      ref_id: r.id,
      title: requisitionTitle(r.request_id, r.products),
      sub: `${r.department?.name || "Department"} · requisition · ${waited === 0 ? "today" : `${plural(waited, "day")} at your step`}`,
      amount,
      pill: waited > replyDays ? { tone: "danger", label: "Overdue" } : null,
      detail: {
        fields,
        ...(r.purpose ? { text: r.purpose, text_label: "Justification" } : {}),
        items: r.products.map((p) => ({
          label: p.name,
          qty: p.quantity,
          amount: Math.round((Number(p.unitPrice) || 0) * (Number(p.quantity) || 0) * 100) / 100,
        })),
        steps,
      },
    };
  });
  return { total, items };
};

/* -------------------------------------------------------------------------- */
/*                             Department reports                              */
/* -------------------------------------------------------------------------- */

/**
 * Branch filter for department_reports: church-wide area reports by
 * `branch_key`, department attendance reports (`dept_att:<id>`) by their
 * department's branch.
 */
export const deptReportScope = async (ctx: WorkspaceContext): Promise<Prisma.department_reportsWhereInput> => {
  const allowed = getBranchScope()?.allowedBranchIds ?? null;
  const areaKeys: Prisma.department_reportsWhereInput = ctx.branchId
    ? { branch_key: ctx.branchId }
    : allowed
      ? { branch_key: { in: allowed } }
      : {};
  if (!ctx.branchId && !allowed) return {};
  const departments = await prisma.department.findMany({ where: branchWhere(ctx), select: { id: true } });
  return {
    OR: [
      { AND: [{ NOT: { report_key: { startsWith: DEPT_ATT_PREFIX } } }, areaKeys] },
      { report_key: { in: departments.map((d) => `${DEPT_ATT_PREFIX}${d.id}`) } },
    ],
  };
};

export const departmentIdOfReportKey = (key: string) =>
  key.startsWith(DEPT_ATT_PREFIX) ? Number(key.slice(DEPT_ATT_PREFIX.length)) || null : null;

const periodLabelOf = (type: string, key: string) => {
  try {
    return parsePeriod(type, key).label;
  } catch {
    return key;
  }
};

/** Department reports waiting for leadership sign-off (status SUBMITTED). */
export const submittedDeptReports = async (ctx: WorkspaceContext, limit = QUEUE_LIMIT) => {
  const [scope, config] = await Promise.all([deptReportScope(ctx), loadReportConfig()]);
  // Attendance reports for departments with the report turned off can't be acted on (the workflow
  // endpoints 404), so they stay out of the list and the `needs` count that reads `total`.
  const disabledKeys = config.dept_attendance.disabled_department_ids.map((id) => `${DEPT_ATT_PREFIX}${id}`);
  const where: Prisma.department_reportsWhereInput = {
    status: "SUBMITTED",
    ...scope,
    ...(disabledKeys.length ? { NOT: { report_key: { in: disabledKeys } } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.department_reports.count({ where }),
    prisma.department_reports.findMany({
      where,
      orderBy: [{ submitted_at: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        report_key: true,
        period_type: true,
        period_key: true,
        branch_key: true,
        submitted_at: true,
        submitted_by_user_id: true,
        wins: true,
        challenges: true,
      },
    }),
  ]);
  const deptIds = rows.map((r) => departmentIdOfReportKey(r.report_key)).filter((id): id is number => Boolean(id));
  const userIds = rows.map((r) => r.submitted_by_user_id).filter((id): id is number => Boolean(id));
  const [departments, users] = await Promise.all([
    deptIds.length ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const items: QueueItem[] = rows.map((r) => {
    const deptId = departmentIdOfReportKey(r.report_key);
    const area = deptId
      ? `${deptName.get(deptId) || "Department"} attendance`
      : REPORT_MAP.get(r.report_key as any)?.area || r.report_key;
    const period = periodLabelOf(r.period_type, r.period_key);
    const by = r.submitted_by_user_id ? userName.get(r.submitted_by_user_id) : null;
    const fields: [string, string][] = [
      ["Report", area],
      ["Period", period],
    ];
    if (r.submitted_at) fields.push(["Submitted", `${longDate(r.submitted_at)}${by ? ` by ${by}` : ""}`]);
    const text = [r.wins, r.challenges].filter((t) => t && t.trim()).join("\n\n");
    return {
      id: `rep-${r.id}`,
      kind: "dept_report",
      ref_id: r.id,
      title: `${area} · ${period}`,
      sub: `Department report · submitted${by ? ` by ${by}` : ""}`,
      pill: null,
      detail: { fields, ...(text ? { text, text_label: "Summary" } : {}) },
      // What /department-reports/approve and /return take; branch_key 0 = church-wide, sent without branch_id.
      selector: {
        report_key: r.report_key,
        period_type: r.period_type,
        period_key: r.period_key,
        ...(r.branch_key > 0 ? { branch_id: r.branch_key } : {}),
      },
    };
  });
  return { total, items };
};

/* -------------------------------------------------------------------------- */
/*                                Appointments                                */
/* -------------------------------------------------------------------------- */

const appointmentWhen = (a: { date: Date; startTime: string; endTime: string }) =>
  `${dayLabel(a.date)}, ${a.startTime}${a.endTime ? `–${a.endTime}` : ""}`;

/** Appointment requests booked with the caller that they have not answered. */
export const pendingAppointmentsForMe = async (ctx: WorkspaceContext, limit = QUEUE_LIMIT) => {
  const where: Prisma.appointmentWhereInput = {
    userId: ctx.userId,
    status: "PENDING",
    date: { gte: dayStart(new Date()) },
  };
  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: limit,
      select: { id: true, fullName: true, purpose: true, note: true, phone: true, date: true, startTime: true, endTime: true },
    }),
  ]);
  const items: QueueItem[] = rows.map((a) => ({
    id: `appt-${a.id}`,
    kind: "appointment",
    ref_id: a.id,
    title: `${a.purpose} · ${a.fullName}`,
    sub: `Appointment request · ${dayLabel(a.date)}, ${a.startTime}`,
    pill: null,
    detail: {
      fields: [
        ["Requested by", a.fullName],
        ["Type", a.purpose],
        ["When", appointmentWhen(a)],
        ["Phone", a.phone || "—"],
      ],
      ...(a.note ? { text: a.note, text_label: "Message from the member" } : {}),
    },
  }));
  return { total, items };
};

/* -------------------------------------------------------------------------- */
/*                               Join requests                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pending department join requests the caller may decide: all of them with
 * Membership_Management manage, otherwise those for departments they head
 * (same rule as departmentJoinRequests canActOnDepartment).
 */
export const pendingJoinRequests = async (ctx: WorkspaceContext, limit = QUEUE_LIMIT) => {
  const manageAll = await ctx.can("Membership_Management", "manage");
  const where: Prisma.department_join_requestWhereInput = {
    status: "PENDING",
    ...branchWhere(ctx),
    ...(manageAll ? {} : { department: { department_head: ctx.userId } }),
  };
  const [total, rows] = await Promise.all([
    prisma.department_join_request.count({ where }),
    prisma.department_join_request.findMany({
      where,
      orderBy: [{ requested_at: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        requested_at: true,
        note: true,
        branch_id: true,
        department: { select: { name: true } },
        user: {
          select: {
            name: true,
            created_at: true,
            department: { select: { department_info: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);
  const branchIds = rows.map((r) => r.branch_id).filter((id): id is number => Boolean(id));
  const branches = branchIds.length
    ? await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
    : [];
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const items: QueueItem[] = rows.map((r) => {
    const branch = r.branch_id ? branchName.get(r.branch_id) : null;
    const current = r.user?.department?.department_info?.name;
    return {
      id: `join-${r.id}`,
      kind: "join_request",
      ref_id: r.id,
      title: `${r.user?.name || "Member"} → ${r.department?.name || "Department"}`,
      sub: `Join department request${branch ? ` · ${branch}` : ""}`,
      pill: null,
      detail: {
        fields: [
          ["Member", r.user?.name || "—"],
          ["Department", r.department?.name || "—"],
          ...(branch ? ([["Branch", branch]] as [string, string][]) : []),
          ["Requested on", longDate(r.requested_at)],
          ...(r.user?.created_at ? ([["Member since", longDate(r.user.created_at)]] as [string, string][]) : []),
          ["Current department", current || "None"],
        ],
        ...(r.note ? { text: r.note, text_label: "Note from the member" } : {}),
      },
    };
  });
  return { total, items };
};

/* -------------------------------------------------------------------------- */
/*                                  Visitors                                   */
/* -------------------------------------------------------------------------- */

/** responsibleMembers is a JSON array (or comma list) of user ids — as the visitors report reads it. */
export const responsibleIds = (raw: string | null): number[] => {
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

const isDone = (status: string | null | undefined) => String(status || "").trim().toLowerCase() === "completed";

const HOW_HEARD: Record<string, string> = {
  friend: "Friend or member",
  advertisement: "Advertisement",
  social_media: "Social media",
  other: "Other",
};

export type RecentVisitor = {
  id: number;
  name: string;
  phone: string | null;
  howHeard: string | null;
  visitDate: Date;
  responsibleId: number | null;
  responsibleName: string | null;
  followUps: number;
  /** Not a member and no completed follow-up. */
  needsFollowUp: boolean;
  /** No responsible member and no follow-up assigned to anyone. */
  unassigned: boolean;
};

/**
 * Visitors who first came in the last 30 days and are not members, with
 * their follow-up state. Definitions follow the visitors report: a follow-up
 * is done when its status is "completed"; the responsible person is the
 * follow-up's assignee, falling back to the visitor's first responsible member.
 */
export const recentVisitors = async (ctx: WorkspaceContext): Promise<RecentVisitor[]> => {
  const since = addDays(dayStart(new Date()), -FOLLOW_UP_WINDOW_DAYS);
  const rows = await prisma.visitor.findMany({
    where: { ...branchWhere(ctx), is_member: false, visitDate: { gte: since } },
    orderBy: [{ visitDate: "desc" }, { id: "desc" }],
    take: 1000,
    select: {
      id: true,
      title: true,
      firstName: true,
      lastName: true,
      phone: true,
      howHeard: true,
      visitDate: true,
      responsibleMembers: true,
      followUps: { select: { status: true, assignedTo: true } },
    },
  });
  const ids = new Set<number>();
  const parsed = rows.map((v) => {
    const assignee = v.followUps.find((f) => f.assignedTo)?.assignedTo ?? null;
    const responsibleId = assignee ?? responsibleIds(v.responsibleMembers)[0] ?? null;
    if (responsibleId) ids.add(responsibleId);
    return { v, responsibleId };
  });
  const users = ids.size
    ? await prisma.user.findMany({ where: { id: { in: Array.from(ids) } }, select: { id: true, name: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return parsed.map(({ v, responsibleId }) => ({
    id: v.id,
    name: [v.title, v.firstName, v.lastName].filter((p) => p && String(p).trim()).join(" "),
    phone: v.phone,
    howHeard: v.howHeard,
    visitDate: v.visitDate,
    responsibleId,
    responsibleName: responsibleId ? userName.get(responsibleId) ?? null : null,
    followUps: v.followUps.length,
    needsFollowUp: !v.followUps.some((f) => isDone(f.status)),
    unassigned: !responsibleId,
  }));
};

export const howHeardLabel = (value: string | null) => {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "Not recorded";
  if (HOW_HEARD[key]) return HOW_HEARD[key];
  const text = key.replace(/[_-]+/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const unassignedVisitorQueue = (visitors: RecentVisitor[], limit = QUEUE_LIMIT) => {
  const list = visitors.filter((v) => v.unassigned && v.needsFollowUp);
  const items: QueueItem[] = list.slice(0, limit).map((v) => ({
    id: `vis-${v.id}`,
    kind: "visitor",
    ref_id: v.id,
    title: v.name,
    sub: `Visitor · visited ${dayLabel(v.visitDate)} · no responsible person`,
    pill: null,
    detail: {
      fields: [
        ["Visited", dayLabel(v.visitDate)],
        ["Phone", v.phone || "—"],
        ["How they heard", howHeardLabel(v.howHeard)],
        ["Responsible person", "Not assigned"],
      ],
    },
  }));
  return { total: list.length, items };
};
