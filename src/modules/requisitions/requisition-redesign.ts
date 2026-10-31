import {
  Prisma,
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  RequisitionApprovalModule,
  RequisitionApproverType,
} from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { assertBranchAccessible, getBranchScopedWhere } from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";
import { DEFAULT_APPROVAL_REPLY_DAYS } from "./requisition-approval-workflow";
import {
  canRequisition,
  requisitionActionNotRevoked,
  requisitionCapabilities,
  requisitionRank,
  requisitionVisibleWhere,
  scopeCoversRequisition,
  seesWholeBranch,
  toRequisitionViewer,
} from "./requisition-access";
import { getRequisition, notifyRequisitionCommentParticipants } from "./requisition-service";

/**
 * Requisition redesign: the overview list (with each approval step), the
 * drawer detail (comments, attachments, history), reminders and analytics.
 *
 * Existing endpoints keep their shapes for older clients; everything here is
 * additive. Shapes are documented in docs/REQUISITIONS_REDESIGN_FRONTEND_GUIDE.md.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
/** Manual reminders to the same approver are at most one an hour. */
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

export type RequisitionStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
type StepStatus = "WAITING" | "PENDING" | "APPROVED" | "REJECTED";
type HistoryTone = "neutral" | "info" | "success" | "warning" | "danger";

type StoredHistoryEntry = {
  at: string;
  type: "reminder" | "revised_as" | "revised_from" | "disbursed";
  actor_user_id?: number | null;
  actor_name?: string | null;
  approver_name?: string | null;
  automatic?: boolean;
  generated_id?: string | null;
};

export type OverviewStep = {
  order: number;
  label: string;
  type: RequisitionApproverType;
  approver: { id: number; name: string };
  status: StepStatus;
  started_at: string | null;
  acted_at: string | null;
  comment: string | null;
  signature: string | null;
};

export type OverviewRow = {
  id: number;
  generated_id: string;
  status: RequisitionStatus;
  raw_status: RequestApprovalStatus;
  requester: { id: number; name: string; position: string | null };
  department: { id: number; name: string };
  event: { id: number; name: string } | null;
  branch_id: number | null;
  currency: string;
  total_amount: number;
  items: { name: string; quantity: number; unit_price: number }[];
  purpose: string | null;
  needed_by: string | null;
  request_date: string;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  last_reminder_at: string | null;
  revised_from: { id: number; generated_id: string } | null;
  revised_to: { id: number; generated_id: string } | null;
  /** Set once an approved requisition is marked disbursed (status stays APPROVED; raw_status is DISBURSED). */
  disbursed: { at: string; by: { id: number; name: string } | null } | null;
  attachment_count: number;
  comment_count: number;
  steps: OverviewStep[];
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

const toStatus = (raw: RequestApprovalStatus): RequisitionStatus =>
  raw === RequestApprovalStatus.Draft
    ? "DRAFT"
    : raw === RequestApprovalStatus.APPROVED || raw === RequestApprovalStatus.DISBURSED
      ? "APPROVED"
      : raw === RequestApprovalStatus.REJECTED
        ? "REJECTED"
        : "PENDING";

const actorIdOf = (user: any): number => {
  const id = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UnauthorizedError("Authenticated user not found");
  }
  return id;
};

/** A Manage role (what `is_manager` has always meant to clients). */
const isManager = (user: any) => requisitionRank(toRequisitionViewer(user)) >= 2;

const parseHistory = (value: Prisma.JsonValue | null | undefined): StoredHistoryEntry[] =>
  Array.isArray(value) ? (value as unknown as StoredHistoryEntry[]) : [];

const appendHistoryTx = async (
  tx: Prisma.TransactionClient,
  requisitionId: number,
  entry: StoredHistoryEntry,
  extra: Prisma.requestUncheckedUpdateInput = {},
) => {
  const row = await tx.request.findUnique({
    where: { id: requisitionId },
    select: { history: true },
  });
  const next = [...parseHistory(row?.history), entry];
  await tx.request.update({
    where: { id: requisitionId },
    data: { ...extra, history: next as unknown as Prisma.InputJsonValue },
  });
};

const getConfigSettings = async () => {
  const config = await prisma.requisition_approval_configs
    .findUnique({
      where: { module: RequisitionApprovalModule.REQUISITION },
      select: {
        approval_reply_days: true,
        similar_item_lookback_days: true,
        is_active: true,
        steps: {
          orderBy: { step_order: "asc" },
          select: { step_order: true, step_type: true, position_id: true, user_id: true },
        },
      },
    })
    .catch(() => null);

  return {
    replyDays: config?.approval_reply_days || DEFAULT_APPROVAL_REPLY_DAYS,
    lookbackDays: config?.similar_item_lookback_days || DEFAULT_LOOKBACK_DAYS,
    steps: config?.steps || [],
  };
};

/* -------------------------------------------------------------------------- */
/*                               Row construction                             */
/* -------------------------------------------------------------------------- */

const overviewInclude = {
  products: { select: { name: true, unitPrice: true, quantity: true } },
  user: { select: { id: true, name: true, position: { select: { name: true } } } },
  department: { select: { id: true, name: true } },
  eventType: { select: { id: true, event_name: true } },
  approval_instances: {
    orderBy: { step_order: "asc" as const },
    select: {
      step_order: true,
      step_type: true,
      approver_user_id: true,
      position_id: true,
      status: true,
      acted_at: true,
      comment: true,
      signature: true,
    },
  },
  _count: { select: { attachmentsList: true, request_comments: true } },
} satisfies Prisma.requestInclude;

type OverviewRequest = Prisma.requestGetPayload<{ include: typeof overviewInclude }>;

/** Names and position labels for every approver and position the rows mention. */
const loadStepLookups = async (requests: OverviewRequest[]) => {
  const userIds = new Set<number>();
  const positionIds = new Set<number>();
  requests.forEach((request) =>
    request.approval_instances.forEach((instance) => {
      userIds.add(instance.approver_user_id);
      if (instance.position_id) positionIds.add(instance.position_id);
    }),
  );
  requests.forEach((request) => {
    if (request.disbursed_by_user_id) userIds.add(request.disbursed_by_user_id);
  });

  const [users, positions] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, position: { select: { name: true } } },
        })
      : Promise.resolve([]),
    positionIds.size
      ? prisma.position.findMany({
          where: { id: { in: [...positionIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    users: new Map(users.map((user) => [user.id, user])),
    positions: new Map(positions.map((position) => [position.id, position.name])),
  };
};

const stepLabel = (
  type: RequisitionApproverType,
  positionName: string | null | undefined,
  approverPosition: string | null | undefined,
) => {
  if (type === RequisitionApproverType.HEAD_OF_DEPARTMENT) return "Head of department";
  if (type === RequisitionApproverType.POSITION) return positionName || "Approver";
  return approverPosition || "Approver";
};

/** Links between a rejected requisition and the draft revised from it. */
const loadRevisionLinks = async (requests: OverviewRequest[]) => {
  const ids = requests.map((request) => request.id);
  const parentIds = requests
    .map((request) => request.revised_from_id)
    .filter((id): id is number => typeof id === "number");
  if (!ids.length) return { parents: new Map(), children: new Map() };

  const [parents, children] = await Promise.all([
    parentIds.length
      ? prisma.request.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, request_id: true },
        })
      : Promise.resolve([]),
    prisma.request.findMany({
      where: { revised_from_id: { in: ids } },
      select: { id: true, request_id: true, revised_from_id: true },
      orderBy: { id: "desc" },
    }),
  ]);

  const childMap = new Map<number, { id: number; generated_id: string }>();
  children.forEach((child) => {
    if (child.revised_from_id && !childMap.has(child.revised_from_id)) {
      childMap.set(child.revised_from_id, { id: child.id, generated_id: child.request_id });
    }
  });

  return {
    parents: new Map(parents.map((parent) => [parent.id, { id: parent.id, generated_id: parent.request_id }])),
    children: childMap,
  };
};

const buildRows = async (requests: OverviewRequest[]): Promise<OverviewRow[]> => {
  const [lookups, links] = await Promise.all([loadStepLookups(requests), loadRevisionLinks(requests)]);

  return requests.map((request) => {
    const submittedAt = request.submitted_at;
    const steps: OverviewStep[] = request.approval_instances.map((instance, index, list) => {
      const approver = lookups.users.get(instance.approver_user_id);
      const previous = index > 0 ? list[index - 1] : null;
      const startedAt =
        instance.status === RequisitionApprovalInstanceStatus.WAITING
          ? null
          : index === 0
            ? submittedAt
            : previous?.acted_at ?? null;
      return {
        order: instance.step_order,
        label: stepLabel(
          instance.step_type,
          instance.position_id ? lookups.positions.get(instance.position_id) : null,
          approver?.position?.name,
        ),
        type: instance.step_type,
        approver: { id: instance.approver_user_id, name: approver?.name || "Unknown approver" },
        status: instance.status as StepStatus,
        started_at: iso(startedAt),
        acted_at: iso(instance.acted_at),
        comment: instance.comment || null,
        signature: instance.signature || null,
      };
    });

    const status = toStatus(request.request_approval_status);
    const decidedStep =
      status === "REJECTED"
        ? steps.find((step) => step.status === "REJECTED")
        : status === "APPROVED"
          ? steps[steps.length - 1]
          : undefined;

    return {
      id: request.id,
      generated_id: request.request_id,
      status,
      raw_status: request.request_approval_status,
      requester: {
        id: request.user.id,
        name: request.user.name,
        position: request.user.position?.name || null,
      },
      department: { id: request.department.id, name: request.department.name },
      event: request.eventType
        ? { id: request.eventType.id, name: request.eventType.event_name || "Event" }
        : null,
      branch_id: request.branch_id,
      currency: request.currency || "GHS",
      total_amount: request.products.reduce(
        (sum, product) => sum + product.unitPrice * product.quantity,
        0,
      ),
      items: request.products.map((product) => ({
        name: product.name,
        quantity: product.quantity,
        unit_price: product.unitPrice,
      })),
      purpose: request.purpose,
      needed_by: iso(request.needed_by),
      request_date: request.requisition_date.toISOString(),
      created_at: (request.created_at || request.requisition_date).toISOString(),
      submitted_at: iso(submittedAt),
      decided_at: decidedStep?.acted_at ?? null,
      last_reminder_at: iso(request.last_reminder_at),
      revised_from: request.revised_from_id ? links.parents.get(request.revised_from_id) || null : null,
      revised_to: links.children.get(request.id) || null,
      disbursed: request.disbursed_at
        ? {
            at: request.disbursed_at.toISOString(),
            by: request.disbursed_by_user_id
              ? {
                  id: request.disbursed_by_user_id,
                  name: lookups.users.get(request.disbursed_by_user_id)?.name || "Unknown",
                }
              : null,
          }
        : null,
      attachment_count: request._count.attachmentsList,
      comment_count: request._count.request_comments,
      steps,
    };
  });
};

/* -------------------------------------------------------------------------- */
/*                                 Overview list                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /requisitions/overview?scope=mine|all&branch_id=
 *
 * mine: everything the viewer raised, drafts included.
 * all: the submitted requisitions the viewer's Requisition scope reaches
 * (whole branch, departments they lead, or their own), plus those that include
 * a step assigned to them (waiting, current or done).
 */
export const getRequisitionOverview = async (
  user: any,
  query: { scope?: unknown; branch_id?: unknown },
) => {
  const viewerId = actorIdOf(user);
  const manager = isManager(user);
  const viewer = toRequisitionViewer(user);
  const scope = query.scope === "mine" ? "mine" : "all";
  const branchWhere = getBranchScopedWhere(query.branch_id) || {};

  const where: Prisma.requestWhereInput =
    scope === "mine"
      ? { ...branchWhere, user_id: viewerId }
      : {
          ...branchWhere,
          request_approval_status: { not: RequestApprovalStatus.Draft },
          ...requisitionVisibleWhere(viewer),
        };

  const [requests, assignedCount, settings] = await Promise.all([
    prisma.request.findMany({ where, include: overviewInclude, orderBy: { id: "desc" } }),
    prisma.requisition_approval_instances.count({ where: { approver_user_id: viewerId } }),
    getConfigSettings(),
  ]);

  const configuredStepsAssigned = settings.steps.some((step) => step.user_id === viewerId);

  return {
    viewer: {
      user_id: viewerId,
      is_manager: manager,
      is_approver: assignedCount > 0 || configuredStepsAssigned,
      can: requisitionCapabilities(viewer),
    },
    reply_days: settings.replyDays,
    lookback_days: settings.lookbackDays,
    requisitions: await buildRows(requests),
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Drawer detail                             */
/* -------------------------------------------------------------------------- */

const changedFieldLabel: Record<string, string> = {
  request_date: "date",
  needed_by: "needed-by date",
  purpose: "reason",
  department_id: "department",
  event_id: "event",
  currency: "currency",
  products: "items",
  attachmentLists: "attachments",
};

const describeChangedFields = (raw: string | null) => {
  try {
    const fields = (JSON.parse(raw || "[]") as string[])
      .map((field) => changedFieldLabel[field])
      .filter(Boolean);
    return fields.length ? ` · changed ${Array.from(new Set(fields)).join(", ")}` : "";
  } catch {
    return "";
  }
};

const buildHistory = (
  row: OverviewRow,
  stored: StoredHistoryEntry[],
  edits: { edited_at: Date; editor_name: string | null; changed_fields: string | null }[],
) => {
  const out: { at: string; text: string; tone: HistoryTone }[] = [];
  const requester = row.requester.name;

  out.push({ at: row.created_at, text: `Draft created by ${requester}`, tone: "neutral" });
  if (row.revised_from) {
    out.push({ at: row.created_at, text: `Revised from ${row.revised_from.generated_id}`, tone: "info" });
  }
  if (row.submitted_at) {
    out.push({ at: row.submitted_at, text: `Signed and submitted by ${requester}`, tone: "info" });
    const first = row.steps[0];
    if (first) {
      out.push({ at: row.submitted_at, text: `Sent to ${first.approver.name} (${first.label})`, tone: "info" });
    }
  }

  row.steps.forEach((step, index) => {
    if (!step.acted_at) return;
    const quote = step.comment ? `: “${step.comment}”` : "";
    if (step.status === "APPROVED") {
      out.push({
        at: step.acted_at,
        text: `Approved and signed by ${step.approver.name} (${step.label})${quote}`,
        tone: "success",
      });
      const next = row.steps[index + 1];
      out.push(
        next
          ? { at: step.acted_at, text: `Sent to ${next.approver.name} (${next.label})`, tone: "info" }
          : { at: step.acted_at, text: `Fully approved. ${requester} and Finance notified`, tone: "success" },
      );
    } else if (step.status === "REJECTED") {
      out.push({
        at: step.acted_at,
        text: `Rejected by ${step.approver.name} (${step.label})${quote}`,
        tone: "danger",
      });
      out.push({ at: step.acted_at, text: `${requester} notified with the reason`, tone: "info" });
    }
  });

  edits.forEach((edit) =>
    out.push({
      at: edit.edited_at.toISOString(),
      text: `Edited by ${edit.editor_name || "someone"}${describeChangedFields(edit.changed_fields)}`,
      tone: "neutral",
    }),
  );

  stored.forEach((entry) => {
    if (entry.type === "reminder") {
      out.push({
        at: entry.at,
        text: entry.automatic
          ? `Automatic reminder sent to ${entry.approver_name || "the approver"} (push and email)`
          : `${entry.actor_name || "An admin"} sent a reminder to ${entry.approver_name || "the approver"} (push and email)`,
        tone: "warning",
      });
    } else if (entry.type === "revised_as") {
      out.push({ at: entry.at, text: `Revised as new draft ${entry.generated_id}`, tone: "info" });
    } else if (entry.type === "disbursed") {
      out.push({ at: entry.at, text: `Marked disbursed by ${entry.actor_name || "someone"}`, tone: "success" });
    }
  });

  return out.sort((a, b) => a.at.localeCompare(b.at));
};

/**
 * GET /requisitions/overview-detail?id=
 * Same row as the overview list plus products (with ids, for editing),
 * attachments, comments and a readable history. Access is checked by
 * getRequisition (requester, manager or approval participant).
 */
export const getRequisitionOverviewDetail = async (rawId: unknown, user: any) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InputValidationError("id must be a positive integer");
  }

  // Throws when the viewer can't see this requisition.
  await getRequisition(id, user);

  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      ...overviewInclude,
      products: { select: { id: true, name: true, unitPrice: true, quantity: true, image_url: true } },
      attachmentsList: { select: { id: true, URL: true } },
      request_comments: {
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          user_id: true,
          comment: true,
          created_at: true,
          request_comment_user: { select: { name: true } },
        },
      },
    },
  });
  if (!request) throw new NotFoundError("Requisition not found");

  const [row] = await buildRows([request as unknown as OverviewRequest]);
  const edits = await prisma.$queryRaw<
    { edited_at: Date; editor_name: string | null; changed_fields: string | null }[]
  >`
    SELECT l.edited_at, u.name AS editor_name, l.changed_fields
    FROM \`requisition_edit_logs\` l
    LEFT JOIN \`user\` u ON u.id = l.editor_user_id
    WHERE l.requisition_id = ${id}
    ORDER BY l.edited_at ASC
  `.catch(() => []);

  // Legacy rows kept the reason as the first comment; show it as the purpose.
  const firstComment = request.request_comments[0];
  const purposeFromComment =
    !row.purpose && firstComment && firstComment.user_id === request.user_id ? firstComment.comment : null;

  return {
    ...row,
    purpose: row.purpose || purposeFromComment || null,
    products: request.products.map((product) => ({
      id: product.id,
      name: product.name,
      quantity: product.quantity,
      unit_price: product.unitPrice,
      image_url: product.image_url,
    })),
    attachments: request.attachmentsList.map((attachment) => ({ id: attachment.id, url: attachment.URL })),
    comments: request.request_comments
      .filter((comment) => !(purposeFromComment && comment.id === firstComment?.id))
      .map((comment) => ({
        id: comment.id,
        user_id: comment.user_id,
        name: comment.request_comment_user?.name || "Unknown",
        comment: comment.comment || "",
        created_at: comment.created_at.toISOString(),
      })),
    history: buildHistory(row, parseHistory(request.history), edits),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Revisions                                */
/* -------------------------------------------------------------------------- */

/** Called after a draft is created with revised_from_id: notes it on the parent. */
export const recordRequisitionRevision = async (parentId: number, child: { id: number; generated_id: string }) => {
  if (!Number.isInteger(parentId) || parentId <= 0) return;
  await prisma.$transaction((tx) =>
    appendHistoryTx(tx, parentId, {
      at: new Date().toISOString(),
      type: "revised_as",
      generated_id: child.generated_id,
    }),
  ).catch(() => undefined);
};

/* -------------------------------------------------------------------------- */
/*                                   Reminders                                */
/* -------------------------------------------------------------------------- */

const sendReminderNotification = async (args: {
  requisitionId: number;
  generatedId: string;
  approverUserId: number;
  requesterName: string;
  daysWaiting: number;
  actorUserId: number | null;
  automatic: boolean;
}) => {
  const waited = Math.max(1, Math.round(args.daysWaiting));
  const body = `${args.generatedId} from ${args.requesterName} has waited ${waited} ${
    waited === 1 ? "day" : "days"
  } for your approval.`;
  await notificationService.createManyInAppNotifications([
    {
      type: "requisition.approval_reminder",
      title: "Requisition waiting for your approval",
      body,
      recipientUserId: args.approverUserId,
      actorUserId: args.actorUserId,
      entityType: "REQUISITION",
      entityId: String(args.requisitionId),
      actionUrl: `/home/requests/${Buffer.from(String(args.requisitionId), "utf8").toString("base64")}`,
      priority: "HIGH",
      dedupeKey: `requisition:${args.requisitionId}:reminder:${args.approverUserId}:${new Date()
        .toISOString()
        .slice(0, 13)}`,
      emailSubject: `Requisition ${args.generatedId} is waiting for your approval`,
      sendEmail: true,
      smsBody: body,
    },
  ]);
};

const pendingStepOf = async (requisitionId: number) => {
  const instances = await prisma.requisition_approval_instances.findMany({
    where: { request_id: requisitionId },
    orderBy: { step_order: "asc" },
    select: { step_order: true, status: true, approver_user_id: true, acted_at: true },
  });
  const index = instances.findIndex((instance) => instance.status === RequisitionApprovalInstanceStatus.PENDING);
  if (index < 0) return null;
  return { pending: instances[index], previousActedAt: index > 0 ? instances[index - 1].acted_at : null };
};

/** POST /requisitions/send-reminder { requisition_id } — `Requisition.send_reminders`, within scope. */
export const sendRequisitionReminder = async (payload: { requisition_id?: unknown }, user: any) => {
  const actorUserId = actorIdOf(user);
  const viewer = toRequisitionViewer(user);
  if (!canRequisition(viewer, "send_reminders")) {
    throw new UnauthorizedError("Your role doesn't allow sending requisition reminders");
  }

  const requisitionId = Number(payload?.requisition_id);
  if (!Number.isInteger(requisitionId) || requisitionId <= 0) {
    throw new InputValidationError("requisition_id must be a positive integer");
  }

  const request = await prisma.request.findUnique({
    where: { id: requisitionId },
    select: {
      id: true,
      request_id: true,
      request_approval_status: true,
      submitted_at: true,
      requisition_date: true,
      last_reminder_at: true,
      user_id: true,
      department_id: true,
      branch_id: true,
      user: { select: { name: true } },
    },
  });
  if (!request) throw new NotFoundError("Requisition not found");
  assertBranchAccessible(request.branch_id);
  if (!scopeCoversRequisition(viewer, request)) {
    throw new UnauthorizedError("You do not have permission to access this requisition");
  }
  if (toStatus(request.request_approval_status) !== "PENDING") {
    throw new InputValidationError("Only requisitions in approval can be chased");
  }
  if (request.last_reminder_at && Date.now() - request.last_reminder_at.getTime() < REMINDER_COOLDOWN_MS) {
    throw new InputValidationError("A reminder went out less than an hour ago. Try again later.");
  }

  const step = await pendingStepOf(requisitionId);
  if (!step) throw new InputValidationError("This requisition has no approver waiting");

  const [approver, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: step.pending.approver_user_id }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } }),
  ]);
  const since = step.previousActedAt || request.submitted_at || request.requisition_date;
  const now = new Date();

  await sendReminderNotification({
    requisitionId,
    generatedId: request.request_id,
    approverUserId: step.pending.approver_user_id,
    requesterName: request.user.name,
    daysWaiting: (now.getTime() - since.getTime()) / DAY_MS,
    actorUserId,
    automatic: false,
  });

  await prisma.$transaction((tx) =>
    appendHistoryTx(
      tx,
      requisitionId,
      {
        at: now.toISOString(),
        type: "reminder",
        actor_user_id: actorUserId,
        actor_name: actor?.name || null,
        approver_name: approver?.name || null,
      },
      { last_reminder_at: now },
    ),
  );

  return { requisition_id: requisitionId, reminded_at: now.toISOString(), approver_name: approver?.name || null };
};

/**
 * Daily job: chase every approver who has held a requisition longer than the
 * reply time, at most once per reply-time window per requisition.
 */
export const runRequisitionAutoReminders = async (now: Date = new Date()) => {
  const { replyDays } = await getConfigSettings();
  const windowMs = replyDays * DAY_MS;

  const pending = await prisma.requisition_approval_instances.findMany({
    where: {
      status: RequisitionApprovalInstanceStatus.PENDING,
      request: {
        request_approval_status: {
          notIn: [
            RequestApprovalStatus.Draft,
            RequestApprovalStatus.APPROVED,
            RequestApprovalStatus.DISBURSED,
            RequestApprovalStatus.REJECTED,
          ],
        },
      },
    },
    select: {
      request_id: true,
      step_order: true,
      approver_user_id: true,
      request: {
        select: {
          request_id: true,
          submitted_at: true,
          requisition_date: true,
          last_reminder_at: true,
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!pending.length) return { sent: 0 };

  const previous = await prisma.requisition_approval_instances.findMany({
    where: {
      OR: pending
        .filter((row) => row.step_order > 1)
        .map((row) => ({ request_id: row.request_id, step_order: row.step_order - 1 })),
    },
    select: { request_id: true, acted_at: true },
  });
  const previousActed = new Map(previous.map((row) => [row.request_id, row.acted_at]));
  const approverIds = [...new Set(pending.map((row) => row.approver_user_id))];
  const approvers = new Map(
    (
      await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
    ).map((approver) => [approver.id, approver.name]),
  );

  let sent = 0;
  for (const row of pending) {
    const since =
      (row.step_order > 1 ? previousActed.get(row.request_id) : null) ||
      row.request.submitted_at ||
      row.request.requisition_date;
    const waited = now.getTime() - since.getTime();
    const lastReminder = row.request.last_reminder_at?.getTime() ?? 0;
    // Remind once the step is over the reply time, then again each window.
    if (waited <= windowMs || now.getTime() - Math.max(lastReminder, since.getTime()) < windowMs) {
      continue;
    }

    try {
      await sendReminderNotification({
        requisitionId: row.request_id,
        generatedId: row.request.request_id,
        approverUserId: row.approver_user_id,
        requesterName: row.request.user.name,
        daysWaiting: waited / DAY_MS,
        actorUserId: null,
        automatic: true,
      });
      await prisma.$transaction((tx) =>
        appendHistoryTx(
          tx,
          row.request_id,
          {
            at: now.toISOString(),
            type: "reminder",
            automatic: true,
            approver_name: approvers.get(row.approver_user_id) || null,
          },
          { last_reminder_at: now },
        ),
      );
      sent += 1;
    } catch (error: any) {
      console.error("[ERROR] Requisition auto reminder failed", {
        requisitionId: row.request_id,
        error: error?.message || String(error),
      });
    }
  }

  return { sent };
};

/* -------------------------------------------------------------------------- */
/*                                   Analytics                                */
/* -------------------------------------------------------------------------- */

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

const parseDay = (value: unknown, label: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new InputValidationError(`${label} must be YYYY-MM-DD`);
  }
  return new Date(`${text}T00:00:00.000Z`);
};

const daysBetween = (from: string | null, to: string | null | Date) => {
  if (!from || !to) return null;
  const end = to instanceof Date ? to.getTime() : new Date(to).getTime();
  return (end - new Date(from).getTime()) / DAY_MS;
};

/** Days a step held the requisition: until its decision, or until now while pending. */
const stepDays = (step: OverviewStep, now: Date) =>
  step.started_at ? daysBetween(step.started_at, step.acted_at ?? (step.status === "PENDING" ? now : null)) : null;

type Bucket = { label: string; start: string; end: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const addDaysUtc = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const buildBuckets = (from: Date, to: Date, bucket: string): Bucket[] => {
  const out: Bucket[] = [];
  if (bucket === "month") {
    let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor < to) {
      const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      out.push({ label: MONTHS[cursor.getUTCMonth()], start: dayKey(cursor), end: dayKey(next) });
      cursor = next;
    }
  } else if (bucket === "week") {
    for (let cursor = from; cursor < to; cursor = addDaysUtc(cursor, 7)) {
      const end = addDaysUtc(cursor, 7) < to ? addDaysUtc(cursor, 7) : to;
      const last = addDaysUtc(end, -1);
      out.push({
        label: `${MONTHS[cursor.getUTCMonth()]} ${cursor.getUTCDate()}–${last.getUTCDate()}`,
        start: dayKey(cursor),
        end: dayKey(end),
      });
    }
  } else {
    for (let cursor = from; cursor < to; cursor = addDaysUtc(cursor, 1)) {
      out.push({
        label: `${DAYS[cursor.getUTCDay()]} ${cursor.getUTCDate()}`,
        start: dayKey(cursor),
        end: dayKey(addDaysUtc(cursor, 1)),
      });
    }
  }
  return out;
};

/**
 * GET /requisitions/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|week|month&department_id=&branch_id=
 * `to` is inclusive. Counted by submission date; "waiting now" figures cover
 * every requisition still in approval regardless of the period.
 */
export const getRequisitionAnalytics = async (
  user: any,
  query: { from?: unknown; to?: unknown; bucket?: unknown; department_id?: unknown; branch_id?: unknown },
) => {
  const viewerId = actorIdOf(user);
  const viewer = toRequisitionViewer(user);
  // The route requires Requisition view; the scope decides which rows count.
  if (requisitionRank(viewer) < 1) {
    throw new UnauthorizedError("Not authorized to view requisition analytics");
  }
  const manager = seesWholeBranch(viewer);

  const now = new Date();
  const from = parseDay(query.from, "from") || new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const toInclusive = parseDay(query.to, "to") || new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  if (toInclusive < from) throw new InputValidationError("to must be on or after from");
  const to = addDaysUtc(toInclusive, 1);
  const spanDays = (to.getTime() - from.getTime()) / DAY_MS;
  if (spanDays > 731) throw new InputValidationError("Pick a period of two years or less");
  const bucket =
    query.bucket === "day" || query.bucket === "week" || query.bucket === "month"
      ? query.bucket
      : spanDays <= 14
        ? "day"
        : spanDays <= 120
          ? "week"
          : "month";

  const departmentId = Number(query.department_id);
  const departmentWhere = Number.isInteger(departmentId) && departmentId > 0 ? { department_id: departmentId } : {};
  // Roles narrower than the whole branch see their scope plus the
  // requisitions that pass through their steps.
  const branchWhere: Prisma.requestWhereInput = {
    ...(getBranchScopedWhere(query.branch_id) || {}),
    ...requisitionVisibleWhere(viewer),
  };
  const pendingStatuses = [RequestApprovalStatus.Awaiting_HOD_Approval, RequestApprovalStatus.Awaiting_Executive_Pastor_Approval];

  const [periodRequests, pendingRequests, settings] = await Promise.all([
    prisma.request.findMany({
      where: {
        ...branchWhere,
        ...departmentWhere,
        request_approval_status: { not: RequestApprovalStatus.Draft },
        OR: [
          { submitted_at: { gte: from, lt: to } },
          { submitted_at: null, requisition_date: { gte: from, lt: to } },
        ],
      },
      include: overviewInclude,
      orderBy: { id: "desc" },
    }),
    prisma.request.findMany({
      where: { ...branchWhere, ...departmentWhere, request_approval_status: { in: pendingStatuses } },
      include: overviewInclude,
    }),
    getConfigSettings(),
  ]);

  const [rows, pendingRows] = await Promise.all([buildRows(periodRequests), buildRows(pendingRequests)]);
  const reply = settings.replyDays;
  const submittedDay = (row: OverviewRow) => (row.submitted_at || row.request_date).slice(0, 10);
  const value = (list: OverviewRow[]) => list.reduce((sum, row) => sum + row.total_amount, 0);
  const approved = rows.filter((row) => row.status === "APPROVED");
  const rejected = rows.filter((row) => row.status === "REJECTED");
  const waitingFor = (row: OverviewRow) => row.steps.find((step) => step.status === "PENDING");

  const currencyCounts = new Map<string, number>();
  rows.forEach((row) => currencyCounts.set(row.currency, (currencyCounts.get(row.currency) || 0) + 1));
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "GHS";

  const timesToApproval = approved
    .map((row) => daysBetween(row.submitted_at, row.decided_at))
    .filter((days): days is number => days !== null);
  const slow = rows.filter((row) => row.steps.some((step) => (stepDays(step, now) || 0) > reply));

  // Steps by order, labelled from the configured workflow when it exists.
  const maxOrder = Math.max(settings.steps.length, ...rows.map((row) => row.steps.length), 0);
  const steps = Array.from({ length: maxOrder }, (_, index) => {
    const order = index + 1;
    const ofOrder = rows.map((row) => row.steps.find((step) => step.order === order)).filter(Boolean) as OverviewStep[];
    const decided = ofOrder.filter((step) => step.acted_at).map((step) => stepDays(step, now)).filter((d): d is number => d !== null);
    const all = ofOrder.map((step) => stepDays(step, now)).filter((d): d is number => d !== null);
    const configured = settings.steps.find((step) => step.step_order === order);
    const label =
      ofOrder[0]?.label ||
      pendingRows.map((row) => row.steps.find((step) => step.order === order)).find(Boolean)?.label ||
      (configured?.step_type === RequisitionApproverType.HEAD_OF_DEPARTMENT ? "Head of department" : `Step ${order}`);
    return {
      order,
      label,
      median_days: round1(median(decided)),
      over_count: all.filter((days) => days > reply).length,
      total: all.length,
      waiting_now: pendingRows.filter((row) => waitingFor(row)?.order === order).length,
    };
  });

  const departments = new Map<number, { department_id: number; name: string; approved_value: number; submitted: number; rejected: number; decided: number }>();
  rows.forEach((row) => {
    const entry = departments.get(row.department.id) || {
      department_id: row.department.id,
      name: row.department.name,
      approved_value: 0,
      submitted: 0,
      rejected: 0,
      decided: 0,
    };
    entry.submitted += 1;
    if (row.status === "APPROVED") {
      entry.approved_value += row.total_amount;
      entry.decided += 1;
    }
    if (row.status === "REJECTED") {
      entry.rejected += 1;
      entry.decided += 1;
    }
    departments.set(row.department.id, entry);
  });

  type ApproverStat = { user_id: number; name: string; role: string; acts: { approved: boolean; days: number | null }[]; waiting: number[] };
  const approvers = new Map<number, ApproverStat>();
  const approverEntry = (step: OverviewStep, row: OverviewRow) => {
    const existing = approvers.get(step.approver.id);
    if (existing) return existing;
    const created: ApproverStat = {
      user_id: step.approver.id,
      name: step.approver.name,
      role: step.type === RequisitionApproverType.HEAD_OF_DEPARTMENT ? `Head of department · ${row.department.name}` : step.label,
      acts: [],
      waiting: [],
    };
    approvers.set(step.approver.id, created);
    return created;
  };
  rows.forEach((row) =>
    row.steps.forEach((step) => {
      if (step.acted_at) approverEntry(step, row).acts.push({ approved: step.status === "APPROVED", days: stepDays(step, now) });
    }),
  );
  pendingRows.forEach((row) => {
    const step = waitingFor(row);
    if (step) approverEntry(step, row).waiting.push(stepDays(step, now) || 0);
  });

  const items = new Map<string, { name: string; times: number; quantity: number; value: number; departments: Set<number> }>();
  rows.forEach((row) =>
    row.items.forEach((item) => {
      const key = item.name.trim().toLowerCase();
      const entry = items.get(key) || { name: item.name.trim(), times: 0, quantity: 0, value: 0, departments: new Set<number>() };
      entry.times += 1;
      entry.quantity += item.quantity;
      entry.value += item.quantity * item.unit_price;
      entry.departments.add(row.department.id);
      items.set(key, entry);
    }),
  );

  const stuck = pendingRows
    .flatMap((row) => {
      const step = waitingFor(row);
      return step ? [{ row, days: stepDays(step, now) || 0 }] : [];
    })
    .filter((entry) => entry.days > reply)
    .sort((a, b) => b.days - a.days);

  return {
    period: { from: dayKey(from), to: dayKey(toInclusive), bucket },
    currency,
    reply_days: reply,
    viewer: { user_id: viewerId, is_manager: manager },
    kpis: {
      submitted: rows.length,
      requested_value: value(rows),
      approved_value: value(approved),
      approved_count: approved.length,
      rejected_count: rejected.length,
      in_approval: rows.filter((row) => row.status === "PENDING").length,
      median_days_to_approval: round1(median(timesToApproval)),
      slow_count: slow.length,
    },
    buckets: buildBuckets(from, to, bucket).map((entry) => {
      const inBucket = rows.filter((row) => submittedDay(row) >= entry.start && submittedDay(row) < entry.end);
      return {
        ...entry,
        submitted: inBucket.length,
        requested_value: value(inBucket),
        approved_value: value(inBucket.filter((row) => row.status === "APPROVED")),
      };
    }),
    steps,
    departments: [...departments.values()].sort((a, b) => b.approved_value - a.approved_value),
    approvers: [...approvers.values()]
      .map((entry) => {
        const days = entry.acts.map((act) => act.days).filter((d): d is number => d !== null);
        return {
          user_id: entry.user_id,
          name: entry.name,
          role: entry.role,
          decided: entry.acts.length,
          approved: entry.acts.filter((act) => act.approved).length,
          median_days: round1(median(days)),
          over_count: days.filter((d) => d > reply).length,
          waiting_now: entry.waiting.length,
          oldest_waiting_days: entry.waiting.length ? round1(Math.max(...entry.waiting)) : null,
        };
      })
      .sort((a, b) => b.decided - a.decided || b.waiting_now - a.waiting_now),
    top_items: [...items.values()]
      .sort((a, b) => b.times - a.times || b.value - a.value)
      .slice(0, 6)
      .map((entry) => ({
        name: entry.name,
        times: entry.times,
        quantity: entry.quantity,
        value: entry.value,
        departments: entry.departments.size,
      })),
    stuck_now: {
      count: stuck.length,
      value: stuck.reduce((sum, entry) => sum + entry.row.total_amount, 0),
      generated_ids: stuck.slice(0, 3).map((entry) => entry.row.generated_id),
    },
    rows: rows.map((row) => ({
      id: row.id,
      generated_id: row.generated_id,
      requester: row.requester.name,
      department: row.department.name,
      event: row.event?.name || null,
      amount: row.total_amount,
      currency: row.currency,
      status: row.status,
      submitted_at: row.submitted_at,
      step_days: row.steps.map((step) => ({ order: step.order, label: step.label, days: round1(stepDays(step, now)) })),
      days_to_decision: round1(daysBetween(row.submitted_at, row.decided_at)),
    })),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Comments                                 */
/* -------------------------------------------------------------------------- */

const MAX_COMMENT_LENGTH = 2000;

/**
 * POST /requisitions/add-comment { requisition_id, comment }
 * Anyone who can open the requisition (requester, manager, any approver on it)
 * can comment, at any stage. update-requisition only lets the current editor
 * comment, which locked out earlier approvers and managers.
 */
export const addRequisitionComment = async (
  payload: { requisition_id?: unknown; comment?: unknown },
  user: any,
) => {
  const actorUserId = actorIdOf(user);
  if (!requisitionActionNotRevoked(toRequisitionViewer(user), "comment")) {
    throw new UnauthorizedError("Your role doesn't allow commenting on requisitions");
  }
  const requisitionId = Number(payload?.requisition_id);
  if (!Number.isInteger(requisitionId) || requisitionId <= 0) {
    throw new InputValidationError("requisition_id must be a positive integer");
  }
  const comment = String(payload?.comment ?? "").trim();
  if (!comment) throw new InputValidationError("Write a comment first");
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new InputValidationError(`Comments can be up to ${MAX_COMMENT_LENGTH} characters`);
  }

  // Throws when the viewer can't see this requisition.
  await getRequisition(requisitionId, user);

  const created = await prisma.request_comments.create({
    data: { request_id: requisitionId, user_id: actorUserId, comment },
    select: { id: true, created_at: true },
  });

  await notifyRequisitionCommentParticipants({ requisitionId, actorUserId, comment }).catch((error: any) =>
    console.error("[ERROR] Requisition comment notification failed", error?.message || String(error)),
  );

  return { id: created.id, created_at: created.created_at.toISOString() };
};

/* -------------------------------------------------------------------------- */
/*                                  Disbursement                              */
/* -------------------------------------------------------------------------- */

/**
 * POST /requisitions/mark-disbursed { requisition_id }
 * Records that an approved requisition has been paid out (or its items handed
 * over): APPROVED -> DISBURSED with who and when. Needs
 * `Requisition.mark_disbursed` (route) and the requisition within the role's
 * scope; the requester can't mark their own.
 */
export const markRequisitionDisbursed = async (
  payload: { requisition_id?: unknown },
  user: any,
) => {
  const actorUserId = actorIdOf(user);
  const viewer = toRequisitionViewer(user);
  if (!canRequisition(viewer, "mark_disbursed")) {
    throw new UnauthorizedError("Your role doesn't allow marking requisitions disbursed");
  }
  const requisitionId = Number(payload?.requisition_id);
  if (!Number.isInteger(requisitionId) || requisitionId <= 0) {
    throw new InputValidationError("requisition_id must be a positive integer");
  }

  const request = await prisma.request.findUnique({
    where: { id: requisitionId },
    select: {
      id: true,
      request_id: true,
      user_id: true,
      department_id: true,
      branch_id: true,
      request_approval_status: true,
    },
  });
  if (!request) throw new NotFoundError("Requisition not found");
  assertBranchAccessible(request.branch_id);
  if (!scopeCoversRequisition(viewer, request)) {
    throw new UnauthorizedError("You do not have permission to access this requisition");
  }
  if (request.user_id === actorUserId) {
    throw new UnauthorizedError("Someone else has to mark your own requisition disbursed");
  }
  if (request.request_approval_status === RequestApprovalStatus.DISBURSED) {
    throw new InputValidationError("This requisition is already marked disbursed");
  }
  if (request.request_approval_status !== RequestApprovalStatus.APPROVED) {
    throw new InputValidationError("Only approved requisitions can be marked disbursed");
  }

  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Guard against a concurrent mark: only an APPROVED row moves.
    const moved = await tx.request.updateMany({
      where: { id: requisitionId, request_approval_status: RequestApprovalStatus.APPROVED },
      data: {
        request_approval_status: RequestApprovalStatus.DISBURSED,
        disbursed_by_user_id: actorUserId,
        disbursed_at: now,
      },
    });
    if (!moved.count) {
      throw new InputValidationError("This requisition is already marked disbursed");
    }
    await appendHistoryTx(tx, requisitionId, {
      at: now.toISOString(),
      type: "disbursed",
      actor_user_id: actorUserId,
      actor_name: actor?.name || null,
    });
  });

  await notificationService
    .createManyInAppNotifications([
      {
        type: "requisition.disbursed",
        title: "Requisition disbursed",
        body: `${request.request_id} has been marked disbursed by ${actor?.name || "the finance team"}.`,
        recipientUserId: request.user_id,
        actorUserId,
        entityType: "REQUISITION",
        entityId: String(requisitionId),
        actionUrl: `/home/requests/${Buffer.from(String(requisitionId), "utf8").toString("base64")}`,
        priority: "MEDIUM",
        dedupeKey: `requisition:${requisitionId}:disbursed`,
      },
    ])
    .catch((error: any) =>
      console.error("[ERROR] Requisition disbursed notification failed", error?.message || String(error)),
    );

  return {
    requisition_id: requisitionId,
    raw_status: RequestApprovalStatus.DISBURSED,
    disbursed: { at: now.toISOString(), by: { id: actorUserId, name: actor?.name || "Unknown" } },
  };
};
