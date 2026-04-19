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
import { userHasMinimumDomainAccess } from "../../../utils/permissionResolver";

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
};

type FinanceApprovalConfigRow = {
  id: number;
  finance_approver_user_id: number;
  is_active: boolean;
  notification_user_ids: number[];
};

type FinanceApprovalConfigEntity = {
  finance_approver_user_id: number | null;
  notification_user_ids: number[];
  is_active: boolean;
};

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
  isEditable: boolean;
  notificationUserIds: number[];
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
  notifications?: Array<{ user_id: number }>;
} | null): FinanceApprovalConfigRow | null => {
  if (!row) return null;

  return {
    id: row.id,
    finance_approver_user_id: row.finance_approver_user_id,
    is_active: Boolean(row.is_active),
    notification_user_ids: Array.from(
      new Set((row.notifications || []).map((item) => item.user_id)),
    ),
  };
};

const computeIsEditable = (args: {
  status: FinanceApprovalStatus;
  actorUserId?: number | null;
  financeApproverUserId?: number | null;
}): boolean => {
  if (args.status === "DRAFT") {
    return true;
  }

  return Boolean(
    args.actorUserId &&
      args.financeApproverUserId &&
      args.actorUserId === args.financeApproverUserId,
  );
};

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
        access: {
          select: {
            permissions: true,
          },
        },
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

    const invalidPermissionUserIds = users
      .filter(
        (user) =>
          !userHasMinimumDomainAccess(
            user.access?.permissions,
            "Financials",
            "view",
          ),
      )
      .map((user) => user.id);

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
  }) {
    const currentStatus = normalizeStatus(args.existingRecord.status);
    if (currentStatus === "DRAFT") {
      return;
    }

    if (
      args.financeApproverUserId &&
      args.actorUserId === args.financeApproverUserId
    ) {
      return;
    }

    throw new FinanceHttpError(
      403,
      "Only the configured finance approver can edit submitted or approved financial records.",
    );
  }

  private mapResponse(
    financial: FinancialRecordRow,
    workflowConfig: FinanceApprovalConfigRow | null,
    actorUserId?: number | null,
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
      isEditable: computeIsEditable({
        status,
        actorUserId,
        financeApproverUserId,
      }),
      notificationUserIds,
    };
  }

  async getApprovalConfig(): Promise<FinanceApprovalConfigEntity> {
    const config = await this.getFinanceApprovalConfig();

    return {
      finance_approver_user_id: config?.finance_approver_user_id ?? null,
      notification_user_ids: config?.notification_user_ids ?? [],
      is_active: config?.is_active ?? true,
    };
  }

  async upsertApprovalConfig(
    payload: FinanceApprovalConfigPayload,
    actorUserId?: number | null,
  ): Promise<FinanceApprovalConfigEntity> {
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
    };
  }

  async create(
    mutation: FinancialMutationPayload,
    actorUserId?: number | null,
  ): Promise<FinancialSaveResult> {
    const normalizedActorUserId = toPositiveInt(actorUserId);
    if (!normalizedActorUserId) {
      throw new FinanceHttpError(401, "Authenticated user is required");
    }

    const config = await this.ensureApprovalConfigReady(mutation.action);
    const periodDate = mutation.payload.metaData.periodDate;

    const existingForPeriod = await prisma.financials.findFirst({
      where: { periodDate },
      select: { id: true },
    });

    if (existingForPeriod) {
      throw new FinanceHttpError(
        409,
        `Financial record for period ${periodDate} already exists`,
      );
    }

    const isFinanceApprover =
      Boolean(config?.finance_approver_user_id) &&
      normalizedActorUserId === config?.finance_approver_user_id;
    const now = new Date();
    const nextStatus: FinanceApprovalStatus =
      mutation.action === "SAVE_DRAFT"
        ? "DRAFT"
        : isFinanceApprover
          ? "APPROVED"
          : "PENDING_APPROVAL";

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
        approved_by_user_id: nextStatus === "APPROVED" ? normalizedActorUserId : null,
        approved_at: nextStatus === "APPROVED" ? now : null,
      },
      select: {
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
      },
    });

    const record = this.mapResponse(created, config, normalizedActorUserId);

    if (nextStatus === "APPROVED" && config?.notification_user_ids.length) {
      await notificationService.createManyInAppNotifications(
        config.notification_user_ids.map((userId) => ({
          type: "financial.approved",
          title: "Financial record approved",
          body: `A financial record for ${periodDate} has been approved.`,
          recipientUserId: userId,
          actorUserId: normalizedActorUserId,
          entityType: "financial",
          entityId: created.id,
          actionUrl: `/home/finance/${created.id}`,
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
        entityId: created.id,
        actionUrl: `/home/finance/${created.id}`,
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

  async findAll(
    pagination: { skip: number; take: number },
    actorUserId?: number | null,
  ): Promise<{
    data: FinancialEntity[];
    total: number;
  }> {
    const config = await this.getFinanceApprovalConfig();
    const [total, financials] = await Promise.all([
      prisma.financials.count(),
      prisma.financials.findMany({
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
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
        },
      }),
    ]);

    return {
      total,
      data: financials.map((financial) =>
        this.mapResponse(financial, config, actorUserId),
      ),
    };
  }

  async findOne(id: string, actorUserId?: number | null): Promise<FinancialEntity> {
    const [config, existing] = await Promise.all([
      this.getFinanceApprovalConfig(),
      prisma.financials.findUnique({
        where: { id },
        select: {
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
        },
      }),
    ]);

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    return this.mapResponse(existing, config, actorUserId);
  }

  async update(
    id: string,
    mutation: FinancialMutationPayload,
    actorUserId?: number | null,
  ): Promise<FinancialSaveResult> {
    const normalizedActorUserId = toPositiveInt(actorUserId);
    if (!normalizedActorUserId) {
      throw new FinanceHttpError(401, "Authenticated user is required");
    }

    const config = await this.ensureApprovalConfigReady(mutation.action);
    const periodDate = mutation.payload.metaData.periodDate;

    const existing = await prisma.financials.findUnique({
      where: { id },
      select: {
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
      },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    this.ensureCanEditRecord({
      existingRecord: existing,
      actorUserId: normalizedActorUserId,
      financeApproverUserId: config?.finance_approver_user_id ?? null,
    });

    const duplicateForPeriod = await prisma.financials.findFirst({
      where: {
        periodDate,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicateForPeriod) {
      throw new FinanceHttpError(
        409,
        `Financial record for period ${periodDate} already exists`,
      );
    }

    const isFinanceApprover =
      Boolean(config?.finance_approver_user_id) &&
      normalizedActorUserId === config?.finance_approver_user_id;
    const now = new Date();
    const nextStatus: FinanceApprovalStatus =
      mutation.action === "SAVE_DRAFT"
        ? "DRAFT"
        : isFinanceApprover
          ? "APPROVED"
          : "PENDING_APPROVAL";

    const updated = await prisma.financials.update({
      where: { id },
      data: {
        payload: this.serializePayload(mutation.payload),
        periodDate,
        status: nextStatus,
        updated_by_user_id: normalizedActorUserId,
        submitted_by_user_id:
          mutation.action === "SAVE_AND_APPROVE" ? normalizedActorUserId : null,
        submitted_at: mutation.action === "SAVE_AND_APPROVE" ? now : null,
        approved_by_user_id: nextStatus === "APPROVED" ? normalizedActorUserId : null,
        approved_at: nextStatus === "APPROVED" ? now : null,
      },
      select: {
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
      },
    });

    const record = this.mapResponse(updated, config, normalizedActorUserId);

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

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await prisma.financials.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    await prisma.financials.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
