import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import {
  FinanceApprovalConfigPayload,
  FinanceApprovalStatus,
  FinanceHttpError,
  FinanceSaveAction,
  FinancialPayload,
  type FinancialMutationPayload,
} from "../common";
import { notificationService } from "../../notifications/notificationService";
import {
  hasActionPermission,
  userHasBranchDomainPermission,
} from "../../../middleWare/authorization";
import { actionAllowed, isLegacyRole } from "../../../permissions/access";
import {
  assertBranchAccessible,
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";
import { getBranchScope } from "../../branches/branchScope";

type FinancialRecordRow = {
  id: string;
  periodDate: string | null;
  payload: string;
  createdAt: Date;
  updatedAt: Date;
  status: string;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  submitted_by_user_id: number | null;
  submitted_at: Date | null;
  approved_by_user_id: number | null;
  approved_at: Date | null;
  returned_by_user_id: number | null;
  returned_at: Date | null;
  return_note: string | null;
  branch_id: number | null;
};

const RECORD_SELECT = {
  id: true,
  periodDate: true,
  payload: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  created_by_user_id: true,
  updated_by_user_id: true,
  submitted_by_user_id: true,
  submitted_at: true,
  approved_by_user_id: true,
  approved_at: true,
  returned_by_user_id: true,
  returned_at: true,
  return_note: true,
  branch_id: true,
} satisfies Prisma.financialsSelect;

type FinanceApprovalConfigRow = {
  id: number;
  finance_approver_user_id: number;
  is_active: boolean;
  notification_user_ids: number[];
  tithe_percentage: number;
};

type FinanceApprovalConfigEntity = {
  finance_approver_user_id: number | null;
  notification_user_ids: number[];
  is_active: boolean;
  tithe_percentage: number;
};

const DEFAULT_TITHE_PERCENTAGE = 10;

/** Receipt totals the weekly record fills in from Giving and Pledges. Major units. */
type FinanceAutoAmounts = {
  from: string;
  to: string;
  online_giving: number;
  online_giving_count: number;
  pledges_redeemed: number;
  pledges_redeemed_count: number;
};

// Mirrors ONLINE_REDEMPTION_METHOD in pledges/payments/service, kept local so
// this module doesn't pull in the Paystack payment stack.
const ONLINE_REDEMPTION_METHOD = "paystack";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type FinancialEntity = {
  id: string;
  periodDate: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  status: FinanceApprovalStatus;
  financeApproverUserId: number | null;
  submittedByUserId: number | null;
  submittedAt: Date | null;
  approvedByUserId: number | null;
  approvedAt: Date | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  returnedByUserId: number | null;
  returnedAt: Date | null;
  returnNote: string | null;
  isEditable: boolean;
  notificationUserIds: number[];
  branch_id: number | null;
};

type FinancialSaveResult = {
  record: FinancialEntity;
  triggeredAction: "DRAFT_SAVED" | "APPROVAL_REQUESTED" | "APPROVED";
  config: FinanceApprovalConfigRow | null;
};

const FINANCE_CONFIG_KEY = "FINANCE";

const normalizeStatus = (value?: string | null): FinanceApprovalStatus => {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === "DRAFT" ||
    normalized === "PENDING_APPROVAL" ||
    normalized === "APPROVED"
  ) {
    return normalized;
  }

  return "DRAFT";
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const mapConfigRow = (row: {
  id: number;
  finance_approver_user_id: number;
  is_active: boolean;
  tithe_percentage?: Prisma.Decimal | number | null;
  notifications?: Array<{ user_id: number }>;
} | null): FinanceApprovalConfigRow | null => {
  if (!row) return null;

  return {
    id: row.id,
    finance_approver_user_id: row.finance_approver_user_id,
    is_active: Boolean(row.is_active),
    tithe_percentage:
      row.tithe_percentage === null || row.tithe_percentage === undefined
        ? DEFAULT_TITHE_PERCENTAGE
        : Number(row.tithe_percentage),
    notification_user_ids: Array.from(
      new Set((row.notifications || []).map((item) => item.user_id)),
    ),
  };
};

/** Live permissions of the caller; `undefined` when the caller isn't known. */
type ActorPermissions = Record<string, any> | undefined;

/**
 * Drafts are editable by whoever prepares records. A submitted record can be
 * corrected by the approver while reviewing it; an approved one only with
 * `Financials.edit_approved` (an on-purpose action).
 */
const computeIsEditable = (args: {
  status: FinanceApprovalStatus;
  actorUserId?: number | null;
  financeApproverUserId?: number | null;
  permissions?: ActorPermissions;
}): boolean => {
  if (args.status === "DRAFT") {
    return true;
  }

  if (actionAllowed(args.permissions, "Financials", "edit_approved")) {
    return true;
  }

  return Boolean(
    args.status === "PENDING_APPROVAL" &&
      args.actorUserId &&
      args.financeApproverUserId &&
      args.actorUserId === args.financeApproverUserId,
  );
};

/** A record the actor prepared or submitted; they may never approve it. */
const isOwnRecord = (
  record: { created_by_user_id: number | null; submitted_by_user_id: number | null },
  actorUserId: number,
): boolean =>
  record.created_by_user_id === actorUserId ||
  record.submitted_by_user_id === actorUserId;

export class FinancialsService {
  private serializePayload(payload: FinancialPayload): string {
    return JSON.stringify(payload);
  }

  private parsePayload(payload: string): Prisma.JsonValue {
    try {
      return JSON.parse(payload) as Prisma.JsonValue;
    } catch (error) {
      return payload;
    }
  }

  private async getFinanceApprovalConfig(): Promise<FinanceApprovalConfigRow | null> {
    const row = await prisma.finance_approval_config.findUnique({
      where: {
        config_key: FINANCE_CONFIG_KEY,
      },
      include: {
        notifications: {
          select: {
            user_id: true,
          },
        },
      },
    });

    return mapConfigRow(row);
  }

  private async validateFinanceAccessUsers(userIds: number[]): Promise<void> {
    const normalizedUserIds = Array.from(
      new Set(
        userIds
          .map((userId) => toPositiveInt(userId))
          .filter((userId): userId is number => Boolean(userId)),
      ),
    );

    if (!normalizedUserIds.length) {
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: normalizedUserIds,
        },
      },
      select: {
        id: true,
        is_active: true,
      },
    });

    const foundUserIds = new Set(users.map((user) => user.id));
    const missingUserIds = normalizedUserIds.filter((userId) => !foundUserIds.has(userId));
    if (missingUserIds.length > 0) {
      throw new FinanceHttpError(
        422,
        `Selected finance users were not found: ${missingUserIds.join(", ")}`,
      );
    }

    const inactiveUserIds = users
      .filter((user) => user.is_active === false)
      .map((user) => user.id);
    if (inactiveUserIds.length > 0) {
      throw new FinanceHttpError(
        422,
        `Selected finance users are inactive: ${inactiveUserIds.join(", ")}`,
      );
    }

    // Live per-branch roles, not the old single-role column.
    const activeBranchId = getBranchScope()?.activeBranchId ?? null;
    const permissionChecks = await Promise.all(
      users.map(async (user) => ({
        id: user.id,
        allowed: await userHasBranchDomainPermission(
          user.id,
          "Financials",
          "view",
          activeBranchId,
        ),
      })),
    );
    const invalidPermissionUserIds = permissionChecks
      .filter((check) => !check.allowed)
      .map((check) => check.id);

    if (invalidPermissionUserIds.length > 0) {
      throw new FinanceHttpError(
        422,
        `Selected users must have Financials access: ${invalidPermissionUserIds.join(", ")}`,
      );
    }
  }

  private async ensureApprovalConfigReady(
    action: FinanceSaveAction,
  ): Promise<FinanceApprovalConfigRow | null> {
    const config = await this.getFinanceApprovalConfig();
    if (action === "SAVE_DRAFT") {
      return config;
    }

    if (!config || !config.is_active) {
      throw new FinanceHttpError(
        422,
        "Finance approval configuration is required before approval can be submitted.",
      );
    }

    return config;
  }

  private ensureCanEditRecord(args: {
    existingRecord: FinancialRecordRow;
    actorUserId: number;
    financeApproverUserId: number | null;
    permissions?: ActorPermissions;
  }) {
    const currentStatus = normalizeStatus(args.existingRecord.status);
    if (
      computeIsEditable({
        status: currentStatus,
        actorUserId: args.actorUserId,
        financeApproverUserId: args.financeApproverUserId,
        permissions: args.permissions,
      })
    ) {
      return;
    }

    throw new FinanceHttpError(
      403,
      currentStatus === "APPROVED"
        ? "Approved records can't be changed without the right to edit approved records."
        : "Only the configured finance approver can edit submitted financial records.",
    );
  }

  /** Which save the caller may make: drafts need `create_draft`, submitting needs `submit`. */
  private ensureCanSave(
    action: FinanceSaveAction,
    permissions: ActorPermissions,
    isFinanceApprover: boolean,
  ) {
    // The approver could always open and fix records; keep that.
    if (isFinanceApprover || permissions === undefined) return;
    const needed = action === "SAVE_DRAFT" ? "create_draft" : "submit";
    if (!actionAllowed(permissions, "Financials", needed)) {
      throw new FinanceHttpError(
        403,
        action === "SAVE_DRAFT"
          ? "Not authorized to save financial drafts"
          : "Not authorized to submit financial records",
      );
    }
  }

  private mapResponse(
    financial: FinancialRecordRow,
    workflowConfig: FinanceApprovalConfigRow | null,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): FinancialEntity {
    const status = normalizeStatus(financial.status);
    const financeApproverUserId = workflowConfig?.finance_approver_user_id ?? null;
    const notificationUserIds = workflowConfig?.notification_user_ids ?? [];

    return {
      id: financial.id,
      periodDate: financial.periodDate,
      payload: this.parsePayload(financial.payload),
      createdAt: financial.createdAt,
      updatedAt: financial.updatedAt,
      status,
      financeApproverUserId,
      submittedByUserId: financial.submitted_by_user_id,
      submittedAt: financial.submitted_at,
      approvedByUserId: financial.approved_by_user_id,
      approvedAt: financial.approved_at,
      createdByUserId: financial.created_by_user_id,
      updatedByUserId: financial.updated_by_user_id,
      returnedByUserId: financial.returned_by_user_id,
      returnedAt: financial.returned_at,
      returnNote: financial.return_note,
      isEditable: computeIsEditable({
        status,
        actorUserId,
        financeApproverUserId,
        permissions,
      }),
      notificationUserIds,
      branch_id: financial.branch_id,
    };
  }

  async getApprovalConfig(): Promise<FinanceApprovalConfigEntity> {
    const config = await this.getFinanceApprovalConfig();

    return {
      finance_approver_user_id: config?.finance_approver_user_id ?? null,
      notification_user_ids: config?.notification_user_ids ?? [],
      is_active: config?.is_active ?? true,
      tithe_percentage: config?.tithe_percentage ?? DEFAULT_TITHE_PERCENTAGE,
    };
  }

  async upsertApprovalConfig(
    payload: FinanceApprovalConfigPayload,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): Promise<FinanceApprovalConfigEntity> {
    const normalizedActorUserId = toPositiveInt(actorUserId);
    const current = await this.getFinanceApprovalConfig();

    if (permissions !== undefined) {
      const sameIds = (a: number[], b: number[]) =>
        JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
      const approvalChanged =
        !current ||
        current.finance_approver_user_id !== payload.finance_approver_user_id ||
        !sameIds(current.notification_user_ids, payload.notification_user_ids) ||
        current.is_active !== (payload.is_active !== false);
      // Roles saved before actions keep changing the tithe rate with Manage.
      const canConfigure =
        actionAllowed(permissions, "Financials", "configure") ||
        (isLegacyRole(permissions) &&
          hasActionPermission(permissions, "Financials", "manage"));
      if (
        approvalChanged &&
        !actionAllowed(permissions, "Financials", "configure_approvals")
      ) {
        throw new FinanceHttpError(403, "Not authorized to change who approves financial records");
      }
      if (!approvalChanged && !canConfigure) {
        throw new FinanceHttpError(403, "Not authorized to change finance configuration");
      }
    }

    // Nobody can make themselves the approver of the records they configure.
    if (
      normalizedActorUserId &&
      payload.finance_approver_user_id === normalizedActorUserId
    ) {
      if (current?.finance_approver_user_id !== normalizedActorUserId) {
        throw new FinanceHttpError(
          422,
          "You can't make yourself the finance approver. Ask another administrator to choose you.",
        );
      }
    }

    await this.validateFinanceAccessUsers([
      payload.finance_approver_user_id,
      ...payload.notification_user_ids,
    ]);

    const updated = await prisma.finance_approval_config.upsert({
      where: {
        config_key: FINANCE_CONFIG_KEY,
      },
      create: {
        config_key: FINANCE_CONFIG_KEY,
        finance_approver_user_id: payload.finance_approver_user_id,
        is_active: payload.is_active !== false,
        ...(payload.tithe_percentage !== undefined && {
          tithe_percentage: new Prisma.Decimal(payload.tithe_percentage),
        }),
        created_by_user_id: toPositiveInt(actorUserId),
        updated_by_user_id: toPositiveInt(actorUserId),
        notifications: {
          create: payload.notification_user_ids.map((userId) => ({
            user_id: userId,
          })),
        },
      },
      update: {
        finance_approver_user_id: payload.finance_approver_user_id,
        is_active: payload.is_active !== false,
        ...(payload.tithe_percentage !== undefined && {
          tithe_percentage: new Prisma.Decimal(payload.tithe_percentage),
        }),
        updated_by_user_id: toPositiveInt(actorUserId),
        notifications: {
          deleteMany: {},
          create: payload.notification_user_ids.map((userId) => ({
            user_id: userId,
          })),
        },
      },
      include: {
        notifications: {
          select: {
            user_id: true,
          },
        },
      },
    });

    const config = mapConfigRow(updated);

    return {
      finance_approver_user_id: config?.finance_approver_user_id ?? null,
      notification_user_ids: config?.notification_user_ids ?? [],
      is_active: config?.is_active ?? true,
      tithe_percentage: config?.tithe_percentage ?? DEFAULT_TITHE_PERCENTAGE,
    };
  }

  async create(
    mutation: FinancialMutationPayload,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): Promise<FinancialSaveResult> {
    const normalizedActorUserId = toPositiveInt(actorUserId);
    if (!normalizedActorUserId) {
      throw new FinanceHttpError(401, "Authenticated user is required");
    }

    const config = await this.ensureApprovalConfigReady(mutation.action);
    const periodDate = mutation.payload.metaData.periodDate;

    const branchId = await resolveBranchIdOrDefault(mutation.branch_id);
    const existingForPeriod = await prisma.financials.findFirst({
      where: { periodDate, branch_id: branchId ?? null },
      select: { id: true },
    });

    if (existingForPeriod) {
      throw new FinanceHttpError(
        409,
        `There is already a record for the week starting ${periodDate}. Open that one instead.`,
      );
    }

    const isFinanceApprover =
      Boolean(config?.finance_approver_user_id) &&
      normalizedActorUserId === config?.finance_approver_user_id;
    this.ensureCanSave(mutation.action, permissions, isFinanceApprover);
    const now = new Date();
    // A new record is always the actor's own, so it never approves itself,
    // not even when the approver prepares it.
    const nextStatus: FinanceApprovalStatus =
      mutation.action === "SAVE_DRAFT" ? "DRAFT" : "PENDING_APPROVAL";

    const created = await prisma.financials.create({
      data: {
        payload: this.serializePayload(mutation.payload),
        periodDate,
        status: nextStatus,
        created_by_user_id: normalizedActorUserId,
        updated_by_user_id: normalizedActorUserId,
        submitted_by_user_id:
          mutation.action === "SAVE_AND_APPROVE" ? normalizedActorUserId : null,
        submitted_at: mutation.action === "SAVE_AND_APPROVE" ? now : null,
        branch_id: branchId,
      },
      select: RECORD_SELECT,
    });

    const record = this.mapResponse(created, config, normalizedActorUserId, permissions);

    if (
      nextStatus === "PENDING_APPROVAL" &&
      config?.finance_approver_user_id &&
      config.finance_approver_user_id !== normalizedActorUserId
    ) {
      await notificationService.createInAppNotification({
        type: "financial.approval_requested",
        title: "Financial approval requested",
        body: `A financial record for ${periodDate} is awaiting your approval.`,
        recipientUserId: config.finance_approver_user_id,
        actorUserId: normalizedActorUserId,
        entityType: "financial",
        entityId: created.id,
        actionUrl: `/home/finance/${created.id}`,
        priority: "HIGH",
        sendEmail: true,
      });
    }

    return {
      record,
      triggeredAction:
        nextStatus === "PENDING_APPROVAL" ? "APPROVAL_REQUESTED" : "DRAFT_SAVED",
      config,
    };
  }

  async findAll(
    pagination: { skip: number; take: number },
    actorUserId?: number | null,
    branchId?: unknown,
    permissions?: ActorPermissions,
  ): Promise<{
    data: FinancialEntity[];
    total: number;
  }> {
    const config = await this.getFinanceApprovalConfig();
    const [total, financials] = await Promise.all([
      prisma.financials.count({
        where: getBranchScopedWhere(branchId),
      }),
      prisma.financials.findMany({
        where: getBranchScopedWhere(branchId),
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: RECORD_SELECT,
      }),
    ]);

    return {
      total,
      data: financials.map((financial) =>
        this.mapResponse(financial, config, actorUserId, permissions),
      ),
    };
  }

  async findOne(
    id: string,
    actorUserId?: number | null,
    branchId?: unknown,
    permissions?: ActorPermissions,
  ): Promise<FinancialEntity> {
    const [config, existing] = await Promise.all([
      this.getFinanceApprovalConfig(),
      prisma.financials.findUnique({
        where: { id },
        select: RECORD_SELECT,
      }),
    ]);

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    assertBranchAccessible(existing.branch_id);
    const branchWhere = getBranchScopedWhere(branchId);
    if (branchId !== undefined && branchWhere?.branch_id !== existing.branch_id) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    return this.mapResponse(existing, config, actorUserId, permissions);
  }

  async update(
    id: string,
    mutation: FinancialMutationPayload,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): Promise<FinancialSaveResult> {
    const normalizedActorUserId = toPositiveInt(actorUserId);
    if (!normalizedActorUserId) {
      throw new FinanceHttpError(401, "Authenticated user is required");
    }

    const config = await this.ensureApprovalConfigReady(mutation.action);
    const periodDate = mutation.payload.metaData.periodDate;

    const existing = await prisma.financials.findUnique({
      where: { id },
      select: RECORD_SELECT,
      });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    assertBranchAccessible(existing.branch_id);
    this.ensureCanEditRecord({
      existingRecord: existing,
      actorUserId: normalizedActorUserId,
      financeApproverUserId: config?.finance_approver_user_id ?? null,
      permissions,
    });

    const targetBranchId =
      mutation.branch_id !== undefined
        ? await resolveBranchIdOrDefault(mutation.branch_id)
        : existing.branch_id;
    const duplicateForPeriod = await prisma.financials.findFirst({
      where: {
        periodDate,
        branch_id: targetBranchId ?? null,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicateForPeriod) {
      throw new FinanceHttpError(
        409,
        `There is already a record for the week starting ${periodDate}. Open that one instead.`,
      );
    }

    const isFinanceApprover =
      Boolean(config?.finance_approver_user_id) &&
      normalizedActorUserId === config?.finance_approver_user_id;
    this.ensureCanSave(mutation.action, permissions, isFinanceApprover);
    const now = new Date();
    // The approver may correct a record someone else submitted and approve it
    // in the same save; a record they prepared or submitted themselves goes
    // back to waiting for approval.
    const approvesOnSave =
      mutation.action === "SAVE_AND_APPROVE" &&
      isFinanceApprover &&
      normalizeStatus(existing.status) === "PENDING_APPROVAL" &&
      !isOwnRecord(existing, normalizedActorUserId) &&
      (permissions === undefined ||
        actionAllowed(permissions, "Financials", "approve"));
    const nextStatus: FinanceApprovalStatus =
      mutation.action === "SAVE_DRAFT"
        ? "DRAFT"
        : approvesOnSave
          ? "APPROVED"
          : "PENDING_APPROVAL";

    const updated = await prisma.financials.update({
      where: { id },
      data: {
        payload: this.serializePayload(mutation.payload),
        periodDate,
        status: nextStatus,
        updated_by_user_id: normalizedActorUserId,
        // Approving on save keeps the original submitter on the record.
        submitted_by_user_id:
          mutation.action === "SAVE_AND_APPROVE"
            ? approvesOnSave
              ? existing.submitted_by_user_id ?? normalizedActorUserId
              : normalizedActorUserId
            : null,
        submitted_at:
          mutation.action === "SAVE_AND_APPROVE"
            ? approvesOnSave
              ? existing.submitted_at ?? now
              : now
            : null,
        approved_by_user_id: nextStatus === "APPROVED" ? normalizedActorUserId : null,
        approved_at: nextStatus === "APPROVED" ? now : null,
        // A resubmission clears the approver's return note; a draft save keeps it
        // so the preparer can still read what to fix.
        ...(mutation.action === "SAVE_AND_APPROVE"
          ? { returned_by_user_id: null, returned_at: null, return_note: null }
          : {}),
        branch_id: targetBranchId,
      },
      select: RECORD_SELECT,
    });

    const record = this.mapResponse(updated, config, normalizedActorUserId, permissions);

    if (nextStatus === "APPROVED" && config?.notification_user_ids.length) {
      await notificationService.createManyInAppNotifications(
        config.notification_user_ids.map((userId) => ({
          type: "financial.approved",
          title: "Financial record approved",
          body: `A financial record for ${periodDate} has been approved.`,
          recipientUserId: userId,
          actorUserId: normalizedActorUserId,
          entityType: "financial",
          entityId: updated.id,
          actionUrl: `/home/finance/${updated.id}`,
          priority: "HIGH",
          sendEmail: true,
        })),
      );
    }

    if (
      nextStatus === "PENDING_APPROVAL" &&
      config?.finance_approver_user_id &&
      config.finance_approver_user_id !== normalizedActorUserId
    ) {
      await notificationService.createInAppNotification({
        type: "financial.approval_requested",
        title: "Financial approval requested",
        body: `A financial record for ${periodDate} is awaiting your approval.`,
        recipientUserId: config.finance_approver_user_id,
        actorUserId: normalizedActorUserId,
        entityType: "financial",
        entityId: updated.id,
        actionUrl: `/home/finance/${updated.id}`,
        priority: "HIGH",
        sendEmail: true,
      });
    }

    return {
      record,
      triggeredAction:
        nextStatus === "APPROVED"
          ? "APPROVED"
          : nextStatus === "PENDING_APPROVAL"
            ? "APPROVAL_REQUESTED"
            : "DRAFT_SAVED",
      config,
    };
  }

  private async loadForReview(id: string, actorUserId?: number | null) {
    // The route requires `Financials.approve`; the chain (the configured
    // approver) decides who, and nobody reviews a record of their own.
    const normalizedActorUserId = toPositiveInt(actorUserId);
    if (!normalizedActorUserId) {
      throw new FinanceHttpError(401, "Authenticated user is required");
    }

    const [config, existing] = await Promise.all([
      this.getFinanceApprovalConfig(),
      prisma.financials.findUnique({ where: { id }, select: RECORD_SELECT }),
    ]);

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    assertBranchAccessible(existing.branch_id);

    if (!config?.finance_approver_user_id || config.finance_approver_user_id !== normalizedActorUserId) {
      throw new FinanceHttpError(403, "Only the finance approver can review submitted records.");
    }

    if (isOwnRecord(existing, normalizedActorUserId)) {
      throw new FinanceHttpError(
        403,
        "You can't review a record you prepared or submitted. Ask another finance approver to review it.",
      );
    }

    if (normalizeStatus(existing.status) !== "PENDING_APPROVAL") {
      throw new FinanceHttpError(409, "This record isn't waiting for approval.");
    }

    return { config, existing, actorId: normalizedActorUserId };
  }

  /** The finance approver approves a submitted record as it stands. */
  async approve(
    id: string,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): Promise<FinancialEntity> {
    const { config, existing, actorId } = await this.loadForReview(id, actorUserId);
    const now = new Date();

    const updated = await prisma.financials.update({
      where: { id },
      data: {
        status: "APPROVED",
        approved_by_user_id: actorId,
        approved_at: now,
        updated_by_user_id: actorId,
        returned_by_user_id: null,
        returned_at: null,
        return_note: null,
      },
      select: RECORD_SELECT,
    });

    const recipients = Array.from(
      new Set(
        [existing.submitted_by_user_id, existing.created_by_user_id, ...config.notification_user_ids].filter(
          (userId): userId is number => Boolean(userId) && userId !== actorId,
        ),
      ),
    );

    if (recipients.length) {
      await notificationService.createManyInAppNotifications(
        recipients.map((userId) => ({
          type: "financial.approved",
          title: "Weekly record approved",
          body: `The weekly record for ${existing.periodDate} has been approved.`,
          recipientUserId: userId,
          actorUserId: actorId,
          entityType: "financial",
          entityId: id,
          actionUrl: `/home/finance/${id}`,
          priority: "HIGH",
          sendEmail: true,
        })),
      );
    }

    return this.mapResponse(updated, config, actorId, permissions);
  }

  /** The finance approver sends a submitted record back as a draft with a note. */
  async returnRecord(
    id: string,
    note: string,
    actorUserId?: number | null,
    permissions?: ActorPermissions,
  ): Promise<FinancialEntity> {
    const trimmed = String(note ?? "").trim();
    if (!trimmed) {
      throw new FinanceHttpError(422, "Say what needs to change.");
    }

    const { config, existing, actorId } = await this.loadForReview(id, actorUserId);
    const now = new Date();

    const updated = await prisma.financials.update({
      where: { id },
      data: {
        status: "DRAFT",
        submitted_by_user_id: null,
        submitted_at: null,
        updated_by_user_id: actorId,
        returned_by_user_id: actorId,
        returned_at: now,
        return_note: trimmed.slice(0, 2000),
      },
      select: RECORD_SELECT,
    });

    const preparer = existing.submitted_by_user_id ?? existing.created_by_user_id;
    if (preparer && preparer !== actorId) {
      await notificationService.createInAppNotification({
        type: "financial.returned",
        title: "Weekly record returned",
        body: `The weekly record for ${existing.periodDate} was returned: "${trimmed.slice(0, 160)}"`,
        recipientUserId: preparer,
        actorUserId: actorId,
        entityType: "financial",
        entityId: id,
        actionUrl: `/home/finance/${id}`,
        priority: "HIGH",
        sendEmail: true,
      });
    }

    return this.mapResponse(updated, config, actorId, permissions);
  }

  /**
   * What a week's "Online giving" and "Pledges Redeemed" receipt lines should
   * read. Online giving counts successful giving contributions by the day they
   * were paid; pledges redeemed counts redemptions recorded by staff (online
   * pledge payments settle into the pledge's own account, not the offering).
   */
  async autoAmounts(from: string, to: string, branchId?: unknown): Promise<FinanceAutoAmounts> {
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
      throw new FinanceHttpError(422, "from and to must be YYYY-MM-DD, with from on or before to");
    }

    const range = {
      gte: new Date(`${from}T00:00:00.000Z`),
      lte: new Date(`${to}T23:59:59.999Z`),
    };
    const branchWhere = getBranchScopedWhere(branchId);

    const [giving, redemptions] = await Promise.all([
      prisma.givingContribution.aggregate({
        where: { status: "success", paid_at: range, ...(branchWhere ?? {}) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.pledge_redemption.aggregate({
        where: {
          date: range,
          method: { not: ONLINE_REDEMPTION_METHOD },
          ...(branchWhere ? { pledger: { group: { pledge: branchWhere } } } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      from,
      to,
      online_giving: (giving._sum.amount ?? 0) / 100,
      online_giving_count: giving._count._all,
      pledges_redeemed: Number(redemptions._sum.amount ?? 0),
      pledges_redeemed_count: redemptions._count._all,
    };
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await prisma.financials.findUnique({
      where: { id },
      select: { id: true, status: true, branch_id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    assertBranchAccessible(existing.branch_id);

    // Submitted and approved weeks feed balances; only drafts can be deleted.
    if (normalizeStatus(existing.status) !== "DRAFT") {
      throw new FinanceHttpError(409, "Only draft records can be deleted.");
    }

    await prisma.financials.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
