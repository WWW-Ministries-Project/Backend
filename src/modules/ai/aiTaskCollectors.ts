import {
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  appointment_status,
  DepartmentReportStatus,
  asset_stock_check_status,
} from "@prisma/client";

import { prisma } from "../../Models/context";
import { userHasBranchDomainPermission } from "../../middleWare/authorization";
import { RawTask, TaskCollector, TaskCollectorContext } from "./aiTaskService";

const fmtDate = (value?: Date | null): string =>
  value ? value.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

const fullName = (first?: string | null, last?: string | null): string =>
  [first, last].filter(Boolean).join(" ").trim() || "Unknown";

const canView = (ctx: TaskCollectorContext, domain: string) =>
  userHasBranchDomainPermission(ctx.userId, domain, "view", ctx.branchId);

const canManage = (ctx: TaskCollectorContext, domain: string) =>
  userHasBranchDomainPermission(ctx.userId, domain, "manage", ctx.branchId);

// --- 1. Requisition approvals pending this user --------------------------------
const requisitionCollector: TaskCollector = {
  source: "requisition",
  async collect(ctx) {
    if (!(await canView(ctx, "Requisition"))) return [];

    const rows = await prisma.requisition_approval_instances.findMany({
      where: {
        approver_user_id: ctx.userId,
        status: RequisitionApprovalInstanceStatus.PENDING,
        request: {
          request_approval_status: {
            notIn: [
              RequestApprovalStatus.Draft,
              RequestApprovalStatus.APPROVED,
              RequestApprovalStatus.REJECTED,
              RequestApprovalStatus.DISBURSED,
            ],
          },
          ...(ctx.branchId ? { branch_id: ctx.branchId } : {}),
        },
      },
      select: {
        request: {
          select: {
            id: true,
            request_id: true,
            purpose: true,
            needed_by: true,
            submitted_at: true,
            requisition_date: true,
            user: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    });

    return rows.map<RawTask>((row) => {
      const request = row.request;
      return {
        // id = requisition (request) id so the frontend can call approval-action.
        id: String(request.id),
        source: "requisition",
        type: "approval",
        title: `Requisition ${request.request_id}${request.purpose ? ` · ${request.purpose}` : ""}`,
        meta: [request.user?.name, request.department?.name].filter(Boolean).join(" · "),
        why: "You're a pending approver. Finance can't proceed until you decide.",
        dueAt: request.needed_by ?? request.submitted_at ?? request.requisition_date ?? null,
        fallbackGroup: "today",
        actions: [
          { key: "approve", label: "Approve", kind: "approve" },
          { key: "open", label: "Review", kind: "open" },
        ],
        screen: "/home/requests",
      };
    });
  },
};

// --- 2. Finance records awaiting approval (global approver) --------------------
const financeCollector: TaskCollector = {
  source: "finance",
  async collect(ctx) {
    if (!(await canView(ctx, "Financials"))) return [];

    const config = await prisma.finance_approval_config.findUnique({
      where: { config_key: "FINANCE" },
      select: { finance_approver_user_id: true },
    });
    if (!config || config.finance_approver_user_id !== ctx.userId) return [];

    const rows = await prisma.financials.findMany({
      where: {
        status: "PENDING_APPROVAL",
        ...(ctx.branchId ? { branch_id: ctx.branchId } : {}),
      },
      select: {
        id: true,
        periodDate: true,
        submitted_at: true,
        branch: { select: { name: true } },
      },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "finance",
      type: "finance",
      title: `Finance record awaiting approval${row.periodDate ? ` · ${row.periodDate}` : ""}`,
      meta: [row.branch?.name, row.submitted_at ? `submitted ${fmtDate(row.submitted_at)}` : ""]
        .filter(Boolean)
        .join(" · "),
      dueAt: row.submitted_at ?? null,
      fallbackGroup: "today",
      actions: [
        { key: "approve", label: "Approve", kind: "approve" },
        { key: "open", label: "Review", kind: "open" },
      ],
      screen: "/home/finance",
    }));
  },
};

// --- 3. Appointments pending this staff member --------------------------------
const appointmentCollector: TaskCollector = {
  source: "appointment",
  async collect(ctx) {
    if (!(await canView(ctx, "Appointments"))) return [];

    const rows = await prisma.appointment.findMany({
      where: {
        userId: ctx.userId,
        status: appointment_status.PENDING,
        ...(ctx.branchId ? { branch_id: ctx.branchId } : {}),
      },
      select: { id: true, fullName: true, purpose: true, date: true, startTime: true },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "appointment",
      type: "approval",
      title: `Appointment request · ${row.fullName || "Unknown"}`,
      meta: [row.purpose, `${fmtDate(row.date)} ${row.startTime ?? ""}`.trim()]
        .filter(Boolean)
        .join(" · "),
      dueAt: row.date ?? null,
      fallbackGroup: "today",
      actions: [
        { key: "approve", label: "Accept", kind: "approve" },
        { key: "open", label: "Open", kind: "open" },
      ],
      screen: "/home/appointments",
    }));
  },
};

// --- 4. Visitor follow-ups assigned to this user ------------------------------
const followUpCollector: TaskCollector = {
  source: "followup",
  async collect(ctx) {
    if (!(await canView(ctx, "Visitors"))) return [];

    const rows = await prisma.follow_up.findMany({
      where: {
        assignedTo: ctx.userId,
        status: { notIn: ["completed", "done"] },
        ...(ctx.branchId ? { visitor: { branch_id: ctx.branchId } } : {}),
      },
      select: {
        id: true,
        date: true,
        type: true,
        visitor: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "followup",
      type: "followup",
      title: `Follow up ${fullName(row.visitor?.firstName, row.visitor?.lastName)}`,
      meta: [row.type, row.visitor?.phone].filter(Boolean).join(" · "),
      dueAt: row.date ?? null,
      fallbackGroup: "today",
      actions: [
        { key: "contacted", label: "Mark contacted", kind: "open" },
        { key: "open", label: "Open profile", kind: "open" },
      ],
      screen: "/home/visitors",
    }));
  },
};

// --- 5. Department reports awaiting approval (Reports managers) ----------------
const reportsCollector: TaskCollector = {
  source: "report",
  async collect(ctx) {
    if (!(await canManage(ctx, "Reports"))) return [];

    const rows = await prisma.department_reports.findMany({
      where: {
        status: DepartmentReportStatus.SUBMITTED,
        ...(ctx.branchId ? { OR: [{ branch_key: ctx.branchId }, { branch_key: 0 }] } : {}),
      },
      select: {
        id: true,
        report_key: true,
        period_key: true,
        period_end: true,
      },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "report",
      type: "report",
      title: `Report awaiting approval · ${row.report_key}`,
      meta: row.period_key || "",
      dueAt: row.period_end ?? null,
      fallbackGroup: "week",
      actions: [{ key: "open", label: "Open reports", kind: "open" }],
      screen: "/home/reports",
    }));
  },
};

// --- 6. Pledges past their deadline -------------------------------------------
const pledgeCollector: TaskCollector = {
  source: "pledge",
  async collect(ctx) {
    if (!(await canView(ctx, "Pledges"))) return [];

    const rows = await prisma.pledge.findMany({
      where: {
        deadline: { lt: ctx.now },
        ...(ctx.branchId ? { branch_id: ctx.branchId } : {}),
      },
      select: { id: true, title: true, deadline: true },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "pledge",
      type: "finance",
      title: row.title ? `Pledge overdue · ${row.title}` : "Pledge past deadline",
      meta: `Deadline ${fmtDate(row.deadline)} · outstanding balances to review`,
      dueAt: row.deadline ?? null,
      fallbackGroup: "week",
      actions: [
        { key: "sms", label: "Send reminders", kind: "sms" },
        { key: "open", label: "Open pledges", kind: "open" },
      ],
      screen: "/home/finance",
    }));
  },
};

// --- 7. Open asset stock-checks -----------------------------------------------
const assetCollector: TaskCollector = {
  source: "asset",
  async collect(ctx) {
    if (!(await canView(ctx, "Asset"))) return [];

    const rows = await prisma.asset_stock_check.findMany({
      where: {
        status: asset_stock_check_status.OPEN,
        ...(ctx.branchId ? { OR: [{ branch_id: ctx.branchId }, { branch_id: null }] } : {}),
      },
      select: { id: true, name: true, due_date: true },
    });

    return rows.map<RawTask>((row) => ({
      id: String(row.id),
      source: "asset",
      type: "asset",
      title: row.name || "Stock check",
      meta: `Reconciliation due ${fmtDate(row.due_date)}`,
      dueAt: row.due_date ?? null,
      fallbackGroup: "week",
      actions: [{ key: "open", label: "Start", kind: "open" }],
      screen: "/home/assets",
    }));
  },
};

/**
 * The registered task sources for the assistant "For you" feed. Each collector
 * is permission- and branch-scoped internally and isolated on failure.
 */
export const buildCollectors = (): TaskCollector[] => [
  requisitionCollector,
  financeCollector,
  appointmentCollector,
  followUpCollector,
  reportsCollector,
  pledgeCollector,
  assetCollector,
];
