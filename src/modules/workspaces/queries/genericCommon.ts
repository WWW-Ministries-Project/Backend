/**
 * Helpers shared by the finance, hod and generic workspace builders:
 * formatting, requisition rows and event agenda rows.
 */
import { RequestApprovalStatus, RequisitionApprovalInstanceStatus, RequisitionApproverType } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { shortDate } from "../../departmentReports/period";
import { ghs } from "../../departmentReports/sections";
import type { AgendaItem, ListItem, Pill, QueueItem, Tone } from "../types";

export const DAY = 86_400_000;
export { ghs, shortDate };

export const pill = (tone: Tone, label: string): Pill => ({ tone, label });
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const pctOf = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);
export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const within = (d: Date | null | undefined, from: Date, to: Date) => !!d && d >= from && d <= to;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYear = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 hours ago", "Yesterday", "19 Oct". */
export const relativeTime = (d: Date, now = new Date()) => {
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${plural(mins, "minute")} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  if (hours < 48) return "Yesterday";
  return shortDate(d);
};

/* --------------------------------- requisitions -------------------------------- */

export const requisitionSelect = {
  id: true,
  request_id: true,
  user_id: true,
  purpose: true,
  currency: true,
  request_approval_status: true,
  requisition_date: true,
  submitted_at: true,
  updated_at: true,
  department: { select: { id: true, name: true } },
  user: { select: { name: true } },
  products: { select: { name: true, quantity: true, unitPrice: true } },
  approval_instances: {
    select: {
      step_order: true,
      step_type: true,
      approver_user_id: true,
      position_id: true,
      status: true,
      acted_at: true,
    },
    orderBy: { step_order: "asc" as const },
  },
} as const;

export type RequisitionRow = {
  id: number;
  request_id: string;
  user_id: number;
  purpose: string | null;
  currency: string;
  request_approval_status: RequestApprovalStatus;
  requisition_date: Date;
  submitted_at: Date | null;
  updated_at: Date | null;
  department: { id: number; name: string };
  user: { name: string };
  products: { name: string; quantity: number; unitPrice: number }[];
  approval_instances: {
    step_order: number;
    step_type: RequisitionApproverType;
    approver_user_id: number;
    position_id: number | null;
    status: RequisitionApprovalInstanceStatus;
    acted_at: Date | null;
  }[];
};

export const requisitionValue = (r: { products: { quantity: number; unitPrice: number }[] }) =>
  sum(r.products.map((p) => num(p.unitPrice) * num(p.quantity)));

export const isGhs = (currency: string | null | undefined) => !currency || currency.toUpperCase() === "GHS";

export const requisitionTitle = (r: RequisitionRow) => {
  const first = r.products[0]?.name?.trim();
  if (first) return r.products.length > 1 ? `${first} +${r.products.length - 1} more` : first;
  return r.purpose?.trim() || r.request_id;
};

export const isPendingRequisition = (s: RequestApprovalStatus) =>
  s === RequestApprovalStatus.Awaiting_HOD_Approval || s === RequestApprovalStatus.Awaiting_Executive_Pastor_Approval;

/** Names and positions the step labels need, in two bounded queries. */
export const loadStepLookups = async (rows: RequisitionRow[]) => {
  const userIds = [...new Set(rows.flatMap((r) => r.approval_instances.map((i) => i.approver_user_id)))];
  const positionIds = [
    ...new Set(rows.flatMap((r) => r.approval_instances.map((i) => i.position_id)).filter((x): x is number => !!x)),
  ];
  const [users, positions] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, position: { select: { name: true } } },
        })
      : Promise.resolve([]),
    positionIds.length
      ? prisma.position.findMany({ where: { id: { in: positionIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const posMap = new Map(positions.map((p) => [p.id, p.name]));
  const label = (i: RequisitionRow["approval_instances"][number]) => {
    if (i.step_type === RequisitionApproverType.HEAD_OF_DEPARTMENT) return "Head of department";
    if (i.step_type === RequisitionApproverType.POSITION) return (i.position_id && posMap.get(i.position_id)) || "Approver";
    return userMap.get(i.approver_user_id)?.position?.name || "Approver";
  };
  const who = (id: number) => userMap.get(id)?.name || "Unknown approver";
  return { label, who };
};
export type StepLookups = Awaited<ReturnType<typeof loadStepLookups>>;

export const currentInstance = (r: RequisitionRow) =>
  r.approval_instances.find((i) => i.status === RequisitionApprovalInstanceStatus.PENDING) || null;

/** When the current step started: the previous step's decision, else submission. */
export const currentStepSince = (r: RequisitionRow) => {
  const cur = currentInstance(r);
  if (!cur) return null;
  const prev = r.approval_instances.filter((i) => i.step_order < cur.step_order && i.acted_at);
  const last = prev.length ? prev[prev.length - 1].acted_at : null;
  return last || r.submitted_at || r.requisition_date;
};

export const requisitionStatusPill = (s: RequestApprovalStatus): Pill =>
  s === RequestApprovalStatus.APPROVED
    ? pill("success", "Approved")
    : s === RequestApprovalStatus.REJECTED
      ? pill("danger", "Rejected")
      : s === RequestApprovalStatus.Draft
        ? pill("neutral", "Draft")
        : pill("warning", "Awaiting approval");

/** "GH₵ 1,850 · raised 18 Oct · at Pastor" */
export const requisitionListItem = (r: RequisitionRow, lookups: StepLookups): ListItem => {
  const value = requisitionValue(r);
  const amount = isGhs(r.currency) ? ghs(value) : `${r.currency} ${Math.round(value).toLocaleString("en-GB")}`;
  const cur = currentInstance(r);
  const parts = [amount, `raised ${shortDate(r.submitted_at || r.requisition_date)}`];
  if (cur && isPendingRequisition(r.request_approval_status)) parts.push(`at ${lookups.label(cur)}`);
  return {
    title: requisitionTitle(r),
    sub: parts.join(" · "),
    pill: requisitionStatusPill(r.request_approval_status),
    ref_id: r.id,
  };
};

/** Full queue row for a requisition waiting on the caller. */
export const requisitionQueueItem = (
  r: RequisitionRow,
  lookups: StepLookups,
  replyDays: number,
  now = new Date(),
): QueueItem => {
  const since = currentStepSince(r);
  const days = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)) : 0;
  const overdue = days > replyDays;
  const value = requisitionValue(r);
  return {
    id: `requisition:${r.id}`,
    kind: "requisition",
    ref_id: r.id,
    title: requisitionTitle(r),
    sub: `${r.department.name} · ${plural(days, "day")} at your step`,
    amount: isGhs(r.currency) ? value : null,
    pill: overdue ? pill("danger", "Overdue") : pill(days >= replyDays ? "warning" : "neutral", plural(days, "day")),
    detail: {
      fields: [
        ["Department", r.department.name],
        ["Raised by", r.user.name],
        ["Raised on", shortDate(r.submitted_at || r.requisition_date)],
        ...(isGhs(r.currency) ? [] : ([["Currency", r.currency]] as [string, string][])),
      ],
      ...(r.purpose ? { text: r.purpose, text_label: "Purpose" } : {}),
      items: r.products.map((p) => ({ label: p.name, qty: p.quantity, amount: num(p.unitPrice) * num(p.quantity) })),
      steps: r.approval_instances.map((i) => ({
        label: lookups.label(i),
        who: lookups.who(i.approver_user_id),
        state:
          i.status === RequisitionApprovalInstanceStatus.APPROVED
            ? ("ok" as const)
            : i.status === RequisitionApprovalInstanceStatus.PENDING
              ? ("cur" as const)
              : ("wait" as const),
        ...(i.acted_at ? { when: shortDate(i.acted_at) } : {}),
      })),
    },
  };
};

export const requisitionReplyDays = async () => {
  const cfg = await prisma.requisition_approval_configs.findUnique({
    where: { module: "REQUISITION" },
    select: { approval_reply_days: true },
  });
  return cfg?.approval_reply_days ?? 3;
};

/* ------------------------------------ events ----------------------------------- */

export const eventSelect = {
  id: true,
  start_date: true,
  start_time: true,
  end_date: true,
  location: true,
  requires_registration: true,
  registration_capacity: true,
  registration_end_date: true,
  event: { select: { event_name: true } },
  _count: { select: { event_registers: true } },
} as const;

export type EventRow = {
  id: number;
  start_date: Date | null;
  start_time: string | null;
  end_date: Date | null;
  location: string | null;
  requires_registration: boolean;
  registration_capacity: number | null;
  registration_end_date: Date | null;
  event: { event_name: string };
  _count: { event_registers: number };
};

export const eventName = (e: EventRow) => e.event?.event_name?.trim() || "Event";

/** Registration still open: enabled, before the deadline and below capacity. */
export const registrationOpen = (e: EventRow, now = new Date()) => {
  if (!e.requires_registration) return false;
  if (e.registration_end_date) {
    const end = dayStart(e.registration_end_date).getTime() + DAY - 1;
    if (end < now.getTime()) return false;
  }
  return !(e.registration_capacity && e._count.event_registers >= e.registration_capacity);
};

/** "09:00 · Main auditorium · 388 of 1,500 registered" with a fill pill. */
export const eventAgendaItem = (e: EventRow, opts: { showNoRegistration?: boolean } = {}): AgendaItem => {
  const parts: string[] = [];
  if (e.start_time) parts.push(e.start_time);
  if (e.location) parts.push(e.location);
  let fill: Pill | null = null;
  if (e.requires_registration) {
    const n = e._count.event_registers;
    const cap = e.registration_capacity;
    parts.push(cap ? `${n.toLocaleString("en-GB")} of ${cap.toLocaleString("en-GB")} registered` : `${n.toLocaleString("en-GB")} registered`);
    if (cap) {
      const pct = Math.round((n / cap) * 100);
      fill = pct >= 100 ? pill("danger", "Full") : pill(pct >= 50 ? "warning" : "info", `${pct}% full`);
    }
  } else if (opts.showNoRegistration) {
    parts.push("no registration");
  }
  return {
    date: (e.start_date || new Date()).toISOString(),
    title: eventName(e),
    sub: parts.join(" · "),
    pill: fill,
    ref_id: e.id,
  };
};

/** Branch filter for event lists: the branch, plus church-wide (null) events. */
export const eventBranchWhere = (branchId: number | null) =>
  branchId ? { OR: [{ branch_id: branchId }, { branch_id: null }] } : {};
