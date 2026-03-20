import {
  Prisma,
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  RequisitionApprovalModule,
  RequisitionNotificationEventStatus,
  RequisitionApproverType,
} from "@prisma/client";
import { sendEmail } from "../../utils/emailService";
import {
  RequisitionApprovalActionPayload,
  RequisitionApprovalConfigPayload,
} from "../../interfaces/requisitions-interface";
import {
  buildUnifiedEmailTemplate,
  escapeEmailHtml,
} from "../../utils/mail_templates/unifiedEmailTemplate";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { notificationService } from "../notifications/notificationService";

type RequisitionApprovalConfigResponse = {
  module: RequisitionApprovalModule;
  requester_user_ids: number[];
  notification_user_ids: number[];
  similar_item_lookback_days: number;
  approvers: Array<{
    order: number;
    type: RequisitionApproverType;
    position_id?: number;
    user_id?: number;
  }>;
  is_active: boolean;
};

type NormalizedApproverStep = {
  order: number;
  type: RequisitionApproverType;
  positionId: number | null;
  userId: number | null;
};

type NormalizedConfigPayload = {
  module: RequisitionApprovalModule;
  requesterUserIds: number[];
  notificationUserIds: number[];
  similarItemLookbackDays: number;
  approvers: NormalizedApproverStep[];
  isActive: boolean;
};

type RequisitionNotificationEventType =
  | "REQUISITION_SUBMITTED"
  | "REQUISITION_FINAL_APPROVED"
  | "REQUISITION_FINAL_REJECTED"
  | "REQUISITION_NEXT_APPROVER_PENDING";

type NotificationEventSummary = {
  id: number;
  eventType: RequisitionNotificationEventType;
  decision: "APPROVED" | "REJECTED" | null;
  recipientCount: number;
  actorUserId: number | null;
};

type RequisitionApprovalActionResult = {
  notificationEvents: NotificationEventSummary[];
};

type ApprovalAction = RequisitionApprovalActionPayload["action"];

type ApprovalWorkflowTx = Prisma.TransactionClient;

const APPROVAL_MODULE_LITERAL_VALUES = {
  REQUISITION: "REQUISITION",
  EVENT_REPORT: "EVENT_REPORT",
} as const;
const REQUISITION_MODULE =
  ((RequisitionApprovalModule as Record<string, string> | undefined)
    ?.REQUISITION ||
    APPROVAL_MODULE_LITERAL_VALUES.REQUISITION) as RequisitionApprovalModule;
const EVENT_REPORT_MODULE =
  ((RequisitionApprovalModule as Record<string, string> | undefined)
    ?.EVENT_REPORT ||
    APPROVAL_MODULE_LITERAL_VALUES.EVENT_REPORT) as RequisitionApprovalModule;
const SUPPORTED_APPROVAL_MODULES: RequisitionApprovalModule[] = [
  APPROVAL_MODULE_LITERAL_VALUES.REQUISITION,
  APPROVAL_MODULE_LITERAL_VALUES.EVENT_REPORT,
] as RequisitionApprovalModule[];
const REQUISITION_PERMISSION_KEYS = ["Requisition", "Requisitions"];
const REQUISITION_MANAGE_PERMISSION_VALUES = ["Can_Manage", "Super_Admin"];
const DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS = 30;
const MAX_NOTIFICATION_RECIPIENTS = 50;
const NOTIFICATION_EVENT_RETRY_LIMIT = 5;
const NOTIFICATION_EVENT_BATCH_SIZE = 5;
const SUBMITTED_EVENT: RequisitionNotificationEventType = "REQUISITION_SUBMITTED";
const FINAL_APPROVED_EVENT: RequisitionNotificationEventType =
  "REQUISITION_FINAL_APPROVED";
const FINAL_REJECTED_EVENT: RequisitionNotificationEventType =
  "REQUISITION_FINAL_REJECTED";
const NEXT_APPROVER_EVENT: RequisitionNotificationEventType =
  "REQUISITION_NEXT_APPROVER_PENDING";

const REQUISITION_APPROVAL_TABLE_NAMES = [
  "requisition_approval_configs",
  "requisition_approval_config_requesters",
  "requisition_approval_config_notifications",
  "requisition_approval_config_steps",
  "requisition_approval_instances",
  "requisition_notification_events",
];

let ensureWorkflowTablesPromise: Promise<void> | null = null;
let areWorkflowTablesEnsured = false;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const isPermissionObject = (
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const normalizePermissionPayload = (
  permissions: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject | null => {
  if (!permissions) return null;

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return null;

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions) as Prisma.JsonValue;
      if (isPermissionObject(parsedPermissions)) {
        return parsedPermissions;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  if (isPermissionObject(permissions)) {
    return permissions;
  }

  return null;
};

const hasRequisitionManagePermission = (
  permissions: Prisma.JsonValue | null | undefined,
): boolean => {
  const normalizedPermissions = normalizePermissionPayload(permissions);
  if (!normalizedPermissions) {
    return false;
  }

  for (const key of REQUISITION_PERMISSION_KEYS) {
    const value = normalizedPermissions[key];
    if (
      typeof value === "string" &&
      REQUISITION_MANAGE_PERMISSION_VALUES.includes(value)
    ) {
      return true;
    }
  }

  return false;
};

export const isRequisitionApprovalTableMissingError = (
  error: unknown,
): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2021") {
    return false;
  }

  const tableFromMeta =
    typeof error.meta?.table === "string" ? error.meta.table : "";
  const fullMessage = `${error.message} ${tableFromMeta}`;

  return REQUISITION_APPROVAL_TABLE_NAMES.some((tableName) =>
    fullMessage.includes(tableName),
  );
};

const getAutoRequesterUserIdsTx = async (
  tx: ApprovalWorkflowTx,
): Promise<number[]> => {
  const users = await tx.user.findMany({
    where: {
      NOT: {
        is_active: false,
      },
    },
    select: {
      id: true,
      access: {
        select: {
          permissions: true,
        },
      },
    },
  });

  return users
    .filter((user) => hasRequisitionManagePermission(user.access?.permissions))
    .map((user) => user.id);
};

const mergeUniqueIds = (ids: number[]): number[] => {
  return Array.from(new Set(ids));
};

const ensureRequisitionApprovalWorkflowTables = async (): Promise<void> => {
  if (areWorkflowTablesEnsured) {
    return;
  }

  if (!ensureWorkflowTablesPromise) {
    ensureWorkflowTablesPromise = (async () => {
      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_configs\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`module\` ENUM('REQUISITION', 'EVENT_REPORT') NOT NULL,
        \`is_active\` BOOLEAN NOT NULL DEFAULT true,
        \`similar_item_lookback_days\` INTEGER NOT NULL DEFAULT ${DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS},
        \`created_by\` INTEGER NULL,
        \`updated_by\` INTEGER NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE INDEX \`requisition_approval_configs_module_key\`(\`module\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_config_requesters\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`config_id\` INTEGER NOT NULL,
        \`user_id\` INTEGER NOT NULL,
        UNIQUE INDEX \`requisition_approval_config_requesters_config_id_user_id_key\`(\`config_id\`, \`user_id\`),
        INDEX \`requisition_approval_config_requesters_user_id_idx\`(\`user_id\`),
        INDEX \`requisition_approval_config_requesters_config_id_idx\`(\`config_id\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_config_notifications\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`config_id\` INTEGER NOT NULL,
        \`user_id\` INTEGER NOT NULL,
        UNIQUE INDEX \`requisition_approval_config_notifications_config_id_user_id_key\`(\`config_id\`, \`user_id\`),
        INDEX \`requisition_approval_config_notifications_user_id_idx\`(\`user_id\`),
        INDEX \`requisition_approval_config_notifications_config_id_idx\`(\`config_id\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_config_steps\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`config_id\` INTEGER NOT NULL,
        \`step_order\` INTEGER NOT NULL,
        \`step_type\` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NOT NULL,
        \`position_id\` INTEGER NULL,
        \`user_id\` INTEGER NULL,
        UNIQUE INDEX \`requisition_approval_config_steps_config_id_step_order_key\`(\`config_id\`, \`step_order\`),
        INDEX \`requisition_approval_config_steps_position_id_idx\`(\`position_id\`),
        INDEX \`requisition_approval_config_steps_user_id_idx\`(\`user_id\`),
        INDEX \`requisition_approval_config_steps_config_id_idx\`(\`config_id\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_instances\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`request_id\` INTEGER NOT NULL,
        \`config_id\` INTEGER NOT NULL,
        \`step_order\` INTEGER NOT NULL,
        \`step_type\` ENUM('HEAD_OF_DEPARTMENT', 'POSITION', 'SPECIFIC_PERSON') NOT NULL,
        \`approver_user_id\` INTEGER NOT NULL,
        \`position_id\` INTEGER NULL,
        \`configured_user_id\` INTEGER NULL,
        \`status\` ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'WAITING',
        \`acted_by_user_id\` INTEGER NULL,
        \`acted_at\` DATETIME(3) NULL,
        \`comment\` VARCHAR(191) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE INDEX \`requisition_approval_instances_request_id_step_order_key\`(\`request_id\`, \`step_order\`),
        INDEX \`requisition_approval_instances_approver_user_id_idx\`(\`approver_user_id\`),
        INDEX \`requisition_approval_instances_status_idx\`(\`status\`),
        INDEX \`requisition_approval_instances_config_id_idx\`(\`config_id\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_notification_events\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`idempotency_key\` VARCHAR(191) NOT NULL,
        \`event_type\` VARCHAR(191) NOT NULL,
        \`requisition_id\` INTEGER NOT NULL,
        \`actor_user_id\` INTEGER NULL,
        \`decision\` VARCHAR(191) NULL,
        \`recipient_user_ids\` LONGTEXT NOT NULL,
        \`status\` ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED_NO_RECIPIENTS') NOT NULL DEFAULT 'PENDING',
        \`attempts\` INTEGER NOT NULL DEFAULT 0,
        \`last_error\` LONGTEXT NULL,
        \`sent_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE INDEX \`requisition_notification_events_idempotency_key_key\`(\`idempotency_key\`),
        INDEX \`requisition_notification_events_status_created_at_idx\`(\`status\`, \`created_at\`),
        INDEX \`requisition_notification_events_requisition_id_idx\`(\`requisition_id\`),
        INDEX \`requisition_notification_events_event_type_idx\`(\`event_type\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `);

      // Best-effort FK wiring for environments where migrations were skipped.
      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_configs\`
        ADD COLUMN \`similar_item_lookback_days\` INTEGER NOT NULL DEFAULT ${DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS};
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_configs\`
        MODIFY \`module\` ENUM('REQUISITION', 'EVENT_REPORT') NOT NULL;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_config_requesters\`
        ADD CONSTRAINT \`requisition_approval_config_requesters_config_id_fkey\`
        FOREIGN KEY (\`config_id\`) REFERENCES \`requisition_approval_configs\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_config_steps\`
        ADD CONSTRAINT \`requisition_approval_config_steps_config_id_fkey\`
        FOREIGN KEY (\`config_id\`) REFERENCES \`requisition_approval_configs\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_config_notifications\`
        ADD CONSTRAINT \`requisition_approval_config_notifications_config_id_fkey\`
        FOREIGN KEY (\`config_id\`) REFERENCES \`requisition_approval_configs\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_instances\`
        ADD CONSTRAINT \`requisition_approval_instances_config_id_fkey\`
        FOREIGN KEY (\`config_id\`) REFERENCES \`requisition_approval_configs\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_approval_instances\`
        ADD CONSTRAINT \`requisition_approval_instances_request_id_fkey\`
        FOREIGN KEY (\`request_id\`) REFERENCES \`request\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}

      try {
        await prisma.$executeRawUnsafe(`
        ALTER TABLE \`requisition_notification_events\`
        ADD CONSTRAINT \`requisition_notification_events_requisition_id_fkey\`
        FOREIGN KEY (\`requisition_id\`) REFERENCES \`request\`(\`id\`)
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      } catch (error) {}
    })()
      .then(() => {
        areWorkflowTablesEnsured = true;
      })
      .finally(() => {
        ensureWorkflowTablesPromise = null;
      });
  }

  await ensureWorkflowTablesPromise;
};

const toTrimmedOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InputValidationError("comment must be a string when provided");
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const parseModule = (value: unknown): RequisitionApprovalModule => {
  if (typeof value !== "string") {
    throw new InputValidationError(
      `module must be one of ${SUPPORTED_APPROVAL_MODULES.join(", ")}`,
    );
  }

  const normalizedValue = value.trim().toUpperCase();
  if (
    !SUPPORTED_APPROVAL_MODULES.includes(
      normalizedValue as RequisitionApprovalModule,
    )
  ) {
    throw new InputValidationError(
      `module must be one of ${SUPPORTED_APPROVAL_MODULES.join(", ")}`,
    );
  }

  return normalizedValue as RequisitionApprovalModule;
};

const parseRequesterUserIds = (
  value: unknown,
  module: RequisitionApprovalModule,
): number[] => {
  if (!Array.isArray(value)) {
    throw new InputValidationError("requester_user_ids must be an array");
  }

  if (module === REQUISITION_MODULE && !value.length) {
    throw new InputValidationError("requester_user_ids must be a non-empty array");
  }

  const ids = value.map((item) => toPositiveInt(item));
  if (ids.some((item) => item === null)) {
    throw new InputValidationError(
      "requester_user_ids must contain only positive integer user ids",
    );
  }

  const uniqueIds = Array.from(new Set(ids as number[]));
  if (uniqueIds.length !== ids.length) {
    throw new InputValidationError("requester_user_ids must be unique");
  }

  return uniqueIds.sort((first, second) => first - second);
};

const parseNotificationUserIds = (value: unknown): number[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InputValidationError("notification_user_ids must be an array when provided");
  }

  const ids = value.map((item) => toPositiveInt(item));
  if (ids.some((item) => item === null)) {
    throw new InputValidationError(
      "notification_user_ids must contain only positive integer user ids",
    );
  }

  const uniqueSortedIds = Array.from(new Set(ids as number[])).sort(
    (first, second) => first - second,
  );

  if (uniqueSortedIds.length > MAX_NOTIFICATION_RECIPIENTS) {
    throw new InputValidationError(
      `notification_user_ids cannot exceed ${MAX_NOTIFICATION_RECIPIENTS} users`,
    );
  }

  return uniqueSortedIds;
};

const parseSimilarItemLookbackDays = (value: unknown): number => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS;
  }

  const parsed = toPositiveInt(value);
  if (!parsed) {
    throw new InputValidationError(
      "similar_item_lookback_days must be a positive integer when provided",
    );
  }

  return parsed;
};

const parseApprovers = (value: unknown): NormalizedApproverStep[] => {
  if (!Array.isArray(value) || !value.length) {
    throw new InputValidationError("approvers must be a non-empty array");
  }

  const parsed = value.map((rawStep, index) => {
    if (typeof rawStep !== "object" || rawStep === null || Array.isArray(rawStep)) {
      throw new InputValidationError(`approvers[${index}] must be an object`);
    }

    const step = rawStep as {
      order?: unknown;
      type?: unknown;
      position_id?: unknown;
      user_id?: unknown;
    };

    const order = toPositiveInt(step.order);
    if (!order) {
      throw new InputValidationError(`approvers[${index}].order must be a positive integer`);
    }

    if (typeof step.type !== "string") {
      throw new InputValidationError(`approvers[${index}].type is required`);
    }

    const type = step.type as RequisitionApproverType;

    if (!Object.values(RequisitionApproverType).includes(type)) {
      throw new InputValidationError(
        `approvers[${index}].type must be one of HEAD_OF_DEPARTMENT, POSITION, SPECIFIC_PERSON`,
      );
    }

    const positionId =
      step.position_id === undefined || step.position_id === null
        ? null
        : toPositiveInt(step.position_id);
    const userId =
      step.user_id === undefined || step.user_id === null
        ? null
        : toPositiveInt(step.user_id);

    if (step.position_id !== undefined && step.position_id !== null && !positionId) {
      throw new InputValidationError(
        `approvers[${index}].position_id must be a positive integer when provided`,
      );
    }

    if (step.user_id !== undefined && step.user_id !== null && !userId) {
      throw new InputValidationError(
        `approvers[${index}].user_id must be a positive integer when provided`,
      );
    }

    if (type === RequisitionApproverType.HEAD_OF_DEPARTMENT) {
      if (positionId !== null || userId !== null) {
        throw new InputValidationError(
          `approvers[${index}] HEAD_OF_DEPARTMENT must not include position_id or user_id`,
        );
      }
    }

    if (type === RequisitionApproverType.POSITION) {
      if (!positionId) {
        throw new InputValidationError(
          `approvers[${index}] POSITION must include position_id`,
        );
      }

      if (userId !== null) {
        throw new InputValidationError(
          `approvers[${index}] POSITION must not include user_id`,
        );
      }
    }

    if (type === RequisitionApproverType.SPECIFIC_PERSON) {
      if (!userId) {
        throw new InputValidationError(
          `approvers[${index}] SPECIFIC_PERSON must include user_id`,
        );
      }

      if (positionId !== null) {
        throw new InputValidationError(
          `approvers[${index}] SPECIFIC_PERSON must not include position_id`,
        );
      }
    }

    return {
      order,
      type,
      positionId,
      userId,
    };
  });

  const orders = parsed.map((step) => step.order);
  const uniqueOrders = Array.from(new Set(orders));
  if (uniqueOrders.length !== orders.length) {
    throw new InputValidationError("approvers must have unique order values");
  }

  const sortedOrders = [...orders].sort((a, b) => a - b);
  for (let index = 0; index < sortedOrders.length; index += 1) {
    const expectedOrder = index + 1;
    if (sortedOrders[index] !== expectedOrder) {
      throw new InputValidationError(
        "approvers order must be sequential starting from 1",
      );
    }
  }

  return parsed.sort((a, b) => a.order - b.order);
};

const normalizeConfigPayload = (
  payload: RequisitionApprovalConfigPayload,
): NormalizedConfigPayload => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InputValidationError("Invalid payload");
  }

  const module = parseModule(payload.module);
  const requesterUserIds = parseRequesterUserIds(
    payload.requester_user_ids,
    module,
  );
  const notificationUserIds = parseNotificationUserIds(
    payload.notification_user_ids,
  );
  const similarItemLookbackDays = parseSimilarItemLookbackDays(
    payload.similar_item_lookback_days,
  );
  const approvers = parseApprovers(payload.approvers);

  let isActive = true;
  if (payload.is_active !== undefined) {
    if (typeof payload.is_active !== "boolean") {
      throw new InputValidationError("is_active must be boolean when provided");
    }

    isActive = payload.is_active;
  }

  return {
    module,
    requesterUserIds,
    notificationUserIds,
    similarItemLookbackDays,
    approvers,
    isActive,
  };
};

const verifyConfigReferences = async (
  tx: ApprovalWorkflowTx,
  payload: NormalizedConfigPayload,
): Promise<void> => {
  const specificApproverUserIds = payload.approvers
    .map((step) => step.userId)
    .filter((id): id is number => Number.isInteger(id));

  const userIdsToCheck = Array.from(
    new Set([
      ...payload.requesterUserIds,
      ...specificApproverUserIds,
      ...payload.notificationUserIds,
    ]),
  );

  if (userIdsToCheck.length) {
    const users = await tx.user.findMany({
      where: {
        id: { in: userIdsToCheck },
      },
      select: {
        id: true,
        is_active: true,
      },
    });

    const missingUserIds = userIdsToCheck.filter(
      (id) => !users.some((user) => user.id === id),
    );

    if (missingUserIds.length) {
      throw new InputValidationError(
        `These users do not exist: ${missingUserIds.join(", ")}`,
      );
    }

    const inactiveUserIds = users
      .filter((user) => user.is_active === false)
      .map((user) => user.id);

    if (inactiveUserIds.length) {
      throw new InputValidationError(
        `These users are inactive: ${inactiveUserIds.join(", ")}`,
      );
    }
  }

  const positionIdsToCheck = Array.from(
    new Set(
      payload.approvers
        .map((step) => step.positionId)
        .filter((id): id is number => Number.isInteger(id)),
    ),
  );

  if (!positionIdsToCheck.length) {
    return;
  }

  const positions = await tx.position.findMany({
    where: {
      id: { in: positionIdsToCheck },
    },
    select: {
      id: true,
    },
  });

  const missingPositionIds = positionIdsToCheck.filter(
    (id) => !positions.some((position) => position.id === id),
  );

  if (missingPositionIds.length) {
    throw new InputValidationError(
      `These positions do not exist: ${missingPositionIds.join(", ")}`,
    );
  }
};

const mapConfigResponse = (config: {
  module: RequisitionApprovalModule;
  is_active: boolean;
  similar_item_lookback_days: number;
  requesters: Array<{ user_id: number }>;
  notifications?: Array<{ user_id: number }>;
  steps: Array<{
    step_order: number;
    step_type: RequisitionApproverType;
    position_id: number | null;
    user_id: number | null;
  }>;
  effectiveRequesterUserIds?: number[];
}): RequisitionApprovalConfigResponse => {
  const configuredRequesterIds = config.requesters.map(
    (requester) => requester.user_id,
  );
  const requesterUserIds =
    config.module === REQUISITION_MODULE
      ? mergeUniqueIds([
          ...configuredRequesterIds,
          ...(config.effectiveRequesterUserIds || []),
        ])
      : configuredRequesterIds;
  const similarItemLookbackDays =
    toPositiveInt(config.similar_item_lookback_days) ||
    DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS;

  return {
    module: config.module,
    requester_user_ids: requesterUserIds,
    notification_user_ids: (config.notifications || []).map(
      (notification) => notification.user_id,
    ),
    similar_item_lookback_days: similarItemLookbackDays,
    approvers: config.steps.map((step) => ({
      order: step.step_order,
      type: step.step_type,
      ...(step.position_id !== null && { position_id: step.position_id }),
      ...(step.user_id !== null && { user_id: step.user_id }),
    })),
    is_active: config.is_active,
  };
};

const getConfigByModuleTx = async (
  tx: ApprovalWorkflowTx,
  module: RequisitionApprovalModule,
): Promise<RequisitionApprovalConfigResponse | null> => {
  let config;
  try {
    config = await tx.requisition_approval_configs.findUnique({
      where: {
        module,
      },
      include: {
        requesters: {
          orderBy: {
            user_id: "asc",
          },
          select: {
            user_id: true,
          },
        },
        notifications: {
          orderBy: {
            user_id: "asc",
          },
          select: {
            user_id: true,
          },
        },
        steps: {
          orderBy: {
            step_order: "asc",
          },
          select: {
            step_order: true,
            step_type: true,
            position_id: true,
            user_id: true,
          },
        },
      },
    });
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      return null;
    }
    throw error;
  }

  if (!config) {
    return null;
  }

  const autoRequesterUserIds =
    module === REQUISITION_MODULE
      ? await getAutoRequesterUserIdsTx(tx)
      : [];
  return mapConfigResponse({
    ...config,
    effectiveRequesterUserIds: autoRequesterUserIds,
  });
};

const getConfigsByModuleTx = async (
  tx: ApprovalWorkflowTx,
): Promise<RequisitionApprovalConfigResponse[]> => {
  let configs;
  try {
    configs = await tx.requisition_approval_configs.findMany({
      where: {
        module: {
          in: SUPPORTED_APPROVAL_MODULES,
        },
      },
      include: {
        requesters: {
          orderBy: {
            user_id: "asc",
          },
          select: {
            user_id: true,
          },
        },
        notifications: {
          orderBy: {
            user_id: "asc",
          },
          select: {
            user_id: true,
          },
        },
        steps: {
          orderBy: {
            step_order: "asc",
          },
          select: {
            step_order: true,
            step_type: true,
            position_id: true,
            user_id: true,
          },
        },
      },
      orderBy: {
        id: "asc",
      },
    });
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      return [];
    }
    throw error;
  }

  if (!configs.length) {
    return [];
  }

  const autoRequesterUserIds = await getAutoRequesterUserIdsTx(tx);
  return configs.map((config) =>
    mapConfigResponse({
      ...config,
      effectiveRequesterUserIds:
        config.module === REQUISITION_MODULE ? autoRequesterUserIds : [],
    }),
  );
};

const getActiveConfigForSubmissionTx = async (tx: ApprovalWorkflowTx) => {
  let config;
  try {
    config = await tx.requisition_approval_configs.findUnique({
      where: {
        module: REQUISITION_MODULE,
      },
      include: {
        requesters: {
          select: {
            user_id: true,
          },
        },
        steps: {
          select: {
            step_order: true,
            step_type: true,
            position_id: true,
            user_id: true,
          },
          orderBy: {
            step_order: "asc",
          },
        },
      },
    });
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      throw new InputValidationError(
        "Requisition approval workflow tables are missing. Run database migrations first.",
      );
    }
    throw error;
  }

  if (!config || !config.is_active) {
    throw new InputValidationError(
      "No active requisition approval config found for module REQUISITION",
    );
  }

  const autoRequesterUserIds = await getAutoRequesterUserIdsTx(tx);
  const effectiveRequesterUserIds = mergeUniqueIds([
    ...config.requesters.map((requester) => requester.user_id),
    ...autoRequesterUserIds,
  ]);

  if (!effectiveRequesterUserIds.length) {
    throw new InputValidationError(
      "Active requisition approval config has no requester_user_ids",
    );
  }

  if (!config.steps.length) {
    throw new InputValidationError(
      "Active requisition approval config has no approver steps",
    );
  }

  return {
    ...config,
    effective_requester_user_ids: effectiveRequesterUserIds,
  };
};

const resolveHeadOfDepartmentApproverUserId = async (
  tx: ApprovalWorkflowTx,
  requesterId: number,
  fallbackDepartmentId?: number,
): Promise<number> => {
  const requesterDepartment = await tx.user_departments.findUnique({
    where: {
      user_id: requesterId,
    },
    select: {
      department_id: true,
    },
  });

  const departmentId = requesterDepartment?.department_id || fallbackDepartmentId;

  if (!departmentId) {
    throw new InputValidationError(
      `Requester ${requesterId} has no department mapped`,
    );
  }

  const department = await tx.department.findUnique({
    where: {
      id: departmentId,
    },
    select: {
      department_head: true,
    },
  });

  if (!department?.department_head) {
    throw new InputValidationError(
      `Department ${departmentId} does not have a head assigned`,
    );
  }

  const departmentHead = await tx.user.findUnique({
    where: {
      id: department.department_head,
    },
    select: {
      id: true,
      is_active: true,
    },
  });

  if (!departmentHead || departmentHead.is_active === false) {
    throw new InputValidationError(
      `Department head user ${department.department_head} is missing or inactive`,
    );
  }

  return departmentHead.id;
};

const resolvePositionApproverUserId = async (
  tx: ApprovalWorkflowTx,
  positionId: number,
): Promise<number> => {
  const users = await tx.user.findMany({
    where: {
      position_id: positionId,
      NOT: {
        is_active: false,
      },
    },
    select: {
      id: true,
    },
  });

  if (!users.length) {
    throw new InputValidationError(
      `No active user is assigned to position ${positionId}`,
    );
  }

  if (users.length > 1) {
    throw new InputValidationError(
      `Position ${positionId} has multiple active assignees; unable to resolve a single approver`,
    );
  }

  return users[0].id;
};

const resolveSpecificApproverUserId = async (
  tx: ApprovalWorkflowTx,
  userId: number,
): Promise<number> => {
  const user = await tx.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      is_active: true,
    },
  });

  if (!user || user.is_active === false) {
    throw new InputValidationError(
      `Configured approver user ${userId} is missing or inactive`,
    );
  }

  return user.id;
};

const resolveApproverUserIdForStep = async (
  tx: ApprovalWorkflowTx,
  args: {
    step: {
      step_type: RequisitionApproverType;
      position_id: number | null;
      user_id: number | null;
    };
    requesterId: number;
    fallbackDepartmentId?: number;
  },
): Promise<number> => {
  const { step, requesterId, fallbackDepartmentId } = args;

  if (step.step_type === RequisitionApproverType.HEAD_OF_DEPARTMENT) {
    return resolveHeadOfDepartmentApproverUserId(
      tx,
      requesterId,
      fallbackDepartmentId,
    );
  }

  if (step.step_type === RequisitionApproverType.POSITION) {
    if (!step.position_id) {
      throw new InputValidationError("POSITION step is missing position_id");
    }

    return resolvePositionApproverUserId(tx, step.position_id);
  }

  if (!step.user_id) {
    throw new InputValidationError("SPECIFIC_PERSON step is missing user_id");
  }

  return resolveSpecificApproverUserId(tx, step.user_id);
};

export const getRequisitionApprovalConfig = async (): Promise<
  RequisitionApprovalConfigResponse | null
> => {
  await ensureRequisitionApprovalWorkflowTables();
  return prisma.$transaction(async (tx) => {
    return getConfigByModuleTx(tx, REQUISITION_MODULE);
  });
};

export const getApprovalConfigByModule = async (
  module: RequisitionApprovalModule,
): Promise<RequisitionApprovalConfigResponse | null> => {
  await ensureRequisitionApprovalWorkflowTables();
  return prisma.$transaction(async (tx) => {
    return getConfigByModuleTx(tx, module);
  });
};

export const listRequisitionApprovalConfigs = async (): Promise<
  RequisitionApprovalConfigResponse[]
> => {
  await ensureRequisitionApprovalWorkflowTables();
  return prisma.$transaction(async (tx) => {
    return getConfigsByModuleTx(tx);
  });
};

export const upsertRequisitionApprovalConfig = async (
  payload: RequisitionApprovalConfigPayload,
  actorUserId?: number,
): Promise<RequisitionApprovalConfigResponse> => {
  const normalizedPayload = normalizeConfigPayload(payload);

  const runUpsert = async () =>
    prisma.$transaction(async (tx) => {
      await verifyConfigReferences(tx, normalizedPayload);

      const config = await tx.requisition_approval_configs.upsert({
        where: {
          module: normalizedPayload.module,
        },
        update: {
          is_active: normalizedPayload.isActive,
          similar_item_lookback_days: normalizedPayload.similarItemLookbackDays,
          updated_by: actorUserId,
        },
        create: {
          module: normalizedPayload.module,
          is_active: normalizedPayload.isActive,
          similar_item_lookback_days: normalizedPayload.similarItemLookbackDays,
          created_by: actorUserId,
          updated_by: actorUserId,
        },
        select: {
          id: true,
        },
      });

      await tx.requisition_approval_config_requesters.deleteMany({
        where: {
          config_id: config.id,
        },
      });

      await tx.requisition_approval_config_steps.deleteMany({
        where: {
          config_id: config.id,
        },
      });

      await tx.requisition_approval_config_notifications.deleteMany({
        where: {
          config_id: config.id,
        },
      });

      if (normalizedPayload.requesterUserIds.length) {
        await tx.requisition_approval_config_requesters.createMany({
          data: normalizedPayload.requesterUserIds.map((userId) => ({
            config_id: config.id,
            user_id: userId,
          })),
        });
      }

      await tx.requisition_approval_config_steps.createMany({
        data: normalizedPayload.approvers.map((step) => ({
          config_id: config.id,
          step_order: step.order,
          step_type: step.type,
          position_id: step.positionId,
          user_id: step.userId,
        })),
      });

      if (normalizedPayload.notificationUserIds.length) {
        await tx.requisition_approval_config_notifications.createMany({
          data: normalizedPayload.notificationUserIds.map((userId) => ({
            config_id: config.id,
            user_id: userId,
          })),
        });
      }

      const updatedConfig = await getConfigByModuleTx(tx, normalizedPayload.module);

      if (!updatedConfig) {
        throw new NotFoundError("Unable to load requisition approval config");
      }

      return updatedConfig;
    });

  try {
    return await runUpsert();
  } catch (error) {
    if (!isRequisitionApprovalTableMissingError(error)) {
      throw error;
    }

    try {
      await ensureRequisitionApprovalWorkflowTables();
      return await runUpsert();
    } catch (retryError) {
      if (!isRequisitionApprovalTableMissingError(retryError)) {
        throw retryError;
      }

      throw new InputValidationError(
        "Requisition approval workflow tables are missing. Run database migrations first.",
      );
    }
  }
};

export const buildRequisitionApprovalSnapshotTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    requestId: number;
    requesterId: number;
    fallbackDepartmentId?: number;
  },
): Promise<void> => {
  const { requestId, requesterId, fallbackDepartmentId } = args;

  let existingRequest;
  let existingInstances: Array<{ id: number }> = [];
  try {
    existingRequest = await tx.request.findUnique({
      where: {
        id: requestId,
      },
      select: {
        id: true,
      },
    });

    existingInstances = await tx.requisition_approval_instances.findMany({
      where: {
        request_id: requestId,
      },
      select: {
        id: true,
      },
      take: 1,
    });
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      throw new InputValidationError(
        "Requisition approval workflow tables are missing. Run database migrations first.",
      );
    }
    throw error;
  }

  if (!existingRequest) {
    throw new NotFoundError("Requisition not found");
  }

  if (existingInstances.length) {
    throw new InputValidationError(
      "Approval chain already exists for this requisition",
    );
  }

  const config = await getActiveConfigForSubmissionTx(tx);

  const requesterAllowed = config.effective_requester_user_ids.includes(
    requesterId,
  );

  if (!requesterAllowed) {
    throw new UnauthorizedError(
      "Requester is not allowed by requisition approval config",
    );
  }

  const snapshotRows = [];
  for (let index = 0; index < config.steps.length; index += 1) {
    const step = config.steps[index];
    const resolvedApproverUserId = await resolveApproverUserIdForStep(tx, {
      step,
      requesterId,
      fallbackDepartmentId,
    });

    snapshotRows.push({
      request_id: requestId,
      config_id: config.id,
      step_order: step.step_order,
      step_type: step.step_type,
      approver_user_id: resolvedApproverUserId,
      position_id: step.position_id,
      configured_user_id: step.user_id,
      status:
        index === 0
          ? RequisitionApprovalInstanceStatus.PENDING
          : RequisitionApprovalInstanceStatus.WAITING,
    });
  }

  await tx.requisition_approval_instances.createMany({
    data: snapshotRows,
  });

  await tx.request.update({
    where: {
      id: requestId,
    },
    data: {
      request_approval_status: RequestApprovalStatus.Awaiting_HOD_Approval,
    },
  });

  const firstStep = snapshotRows.find((row) => row.step_order === 1) || snapshotRows[0];
  if (firstStep) {
    const recipientUserIds = await resolveActiveRecipientUserIdsTx(
      tx,
      [firstStep.approver_user_id],
      requesterId,
    );

    await createNotificationEventTx(tx, {
      idempotencyKey: buildSubmissionIdempotencyKey(requestId),
      eventType: SUBMITTED_EVENT,
      requisitionId: requestId,
      actorUserId: requesterId,
      recipientUserIds,
    });
  }
};

export const submitRequisitionForApproval = async (args: {
  requestId: number;
  requesterId: number;
  fallbackDepartmentId?: number;
}): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await buildRequisitionApprovalSnapshotTx(tx, args);
  });
};

const parseApprovalAction = (value: unknown): ApprovalAction => {
  if (value !== "APPROVE" && value !== "REJECT") {
    throw new InputValidationError("action must be APPROVE or REJECT");
  }

  return value;
};

export const validateApprovalActionPayload = (
  payload: RequisitionApprovalActionPayload,
): {
  requisitionId: number;
  action: ApprovalAction;
  comment?: string;
} => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InputValidationError("Invalid payload");
  }

  const requisitionId = toPositiveInt(payload.requisition_id);
  if (!requisitionId) {
    throw new InputValidationError("requisition_id must be a positive integer");
  }

  const action = parseApprovalAction(payload.action);
  const comment = toTrimmedOptionalString(payload.comment);

  return {
    requisitionId,
    action,
    ...(comment && { comment }),
  };
};

const getUniqueSortedPositiveIds = (values: number[]): number[] =>
  Array.from(
    new Set(
      values.filter((value) => Number.isInteger(value) && value > 0),
    ),
  ).sort((first, second) => first - second);

const isFinalDecisionEventType = (
  eventType: RequisitionNotificationEventType,
): boolean =>
  eventType === FINAL_APPROVED_EVENT || eventType === FINAL_REJECTED_EVENT;

const isSupportedNotificationEventType = (
  value: string,
): value is RequisitionNotificationEventType =>
  value === SUBMITTED_EVENT ||
  value === FINAL_APPROVED_EVENT ||
  value === FINAL_REJECTED_EVENT ||
  value === NEXT_APPROVER_EVENT;

const normalizeDecision = (
  value: string | null | undefined,
): "APPROVED" | "REJECTED" | null => {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }

  return null;
};

const emitFinalDecisionMetric = (args: {
  metricName: string;
  requisitionId: number;
  decision: "APPROVED" | "REJECTED" | null;
  recipientCount: number;
  actorUserId: number | null;
  error?: string;
}) => {
  const payload = {
    requisition_id: args.requisitionId,
    decision: args.decision,
    recipient_count: args.recipientCount,
    actor_user_id: args.actorUserId,
    ...(args.error ? { error: args.error } : {}),
  };

  const serializedPayload = JSON.stringify(payload);
  if (args.metricName.endsWith(".failed")) {
    console.error(`${args.metricName} ${serializedPayload}`);
    return;
  }

  console.info(`${args.metricName} ${serializedPayload}`);
};

const buildFinalDecisionIdempotencyKey = (
  requisitionId: number,
  eventType: RequisitionNotificationEventType,
) => `requisition:${requisitionId}:event:${eventType}`;

const buildSubmissionIdempotencyKey = (requisitionId: number) =>
  `requisition:${requisitionId}:event:${SUBMITTED_EVENT}:step:1`;

const buildNextApproverIdempotencyKey = (
  requisitionId: number,
  stepOrder: number,
) => `requisition:${requisitionId}:event:${NEXT_APPROVER_EVENT}:step:${stepOrder}`;

const encodeRequisitionIdForRoute = (requisitionId: number): string =>
  Buffer.from(String(requisitionId), "utf8").toString("base64");

const buildRequisitionActionUrl = (requisitionId: number): string =>
  `/home/requests/${encodeRequisitionIdForRoute(requisitionId)}`;

const toAbsoluteActionUrl = (actionUrl: string): string => {
  if (/^https?:\/\//i.test(actionUrl)) {
    return actionUrl;
  }

  const frontendBaseUrl = String(process.env.Frontend_URL || "").trim();
  if (!frontendBaseUrl) {
    return actionUrl;
  }

  const normalizedBaseUrl = frontendBaseUrl.replace(/\/+$/, "");
  const normalizedActionUrl = actionUrl.startsWith("/")
    ? actionUrl
    : `/${actionUrl}`;
  return `${normalizedBaseUrl}${normalizedActionUrl}`;
};

const isIdempotencyConflictError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2002") {
    return false;
  }

  const targetMeta = Array.isArray(error.meta?.target)
    ? error.meta?.target.join(",")
    : String(error.meta?.target || "");

  return targetMeta.includes("idempotency_key");
};

const resolveActiveRecipientUserIdsTx = async (
  tx: ApprovalWorkflowTx,
  candidateUserIds: number[],
  actorUserId?: number,
): Promise<number[]> => {
  const uniqueCandidateUserIds = getUniqueSortedPositiveIds(candidateUserIds);
  if (!uniqueCandidateUserIds.length) {
    return [];
  }

  const activeUsers = await tx.user.findMany({
    where: {
      id: {
        in: uniqueCandidateUserIds,
      },
      NOT: {
        is_active: false,
      },
    },
    select: {
      id: true,
    },
  });

  const activeUserIdSet = new Set(activeUsers.map((user) => user.id));
  return uniqueCandidateUserIds.filter(
    (userId) => activeUserIdSet.has(userId) && userId !== actorUserId,
  );
};

const createNotificationEventTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    idempotencyKey: string;
    eventType: RequisitionNotificationEventType;
    requisitionId: number;
    actorUserId?: number;
    decision?: "APPROVED" | "REJECTED";
    recipientUserIds: number[];
  },
): Promise<NotificationEventSummary | null> => {
  const recipientUserIds = getUniqueSortedPositiveIds(args.recipientUserIds);
  const status = recipientUserIds.length
    ? RequisitionNotificationEventStatus.PENDING
    : RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS;

  try {
    const event = await tx.requisition_notification_events.create({
      data: {
        idempotency_key: args.idempotencyKey,
        event_type: args.eventType,
        requisition_id: args.requisitionId,
        actor_user_id: args.actorUserId,
        decision: args.decision || null,
        recipient_user_ids: JSON.stringify(recipientUserIds),
        status,
      },
      select: {
        id: true,
      },
    });

    return {
      id: event.id,
      eventType: args.eventType,
      decision: args.decision || null,
      recipientCount: recipientUserIds.length,
      actorUserId: args.actorUserId || null,
    };
  } catch (error) {
    if (isIdempotencyConflictError(error)) {
      return null;
    }

    throw error;
  }
};

const buildFinalDecisionEmailTemplate = (args: {
  decision: "APPROVED" | "REJECTED";
  requisitionReference: string;
  requesterName: string;
  departmentName: string;
  actorName: string;
  actionUrl: string;
}) => {
  const isApproved = args.decision === "APPROVED";
  const statusText = isApproved ? "approved" : "rejected";
  const statusColor = isApproved ? "#166534" : "#991b1b";
  const messageHtml = `<p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        A requisition has reached a final decision.
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Requisition:</strong> ${escapeEmailHtml(args.requisitionReference)}
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Requester:</strong> ${escapeEmailHtml(args.requesterName)}
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Department:</strong> ${escapeEmailHtml(args.departmentName)}
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Final Approver:</strong> ${escapeEmailHtml(args.actorName)}
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Status:</strong>
                        <span style="color:${statusColor};font-weight:700;text-transform:uppercase;">${escapeEmailHtml(statusText)}</span>
                      </p>`;

  return buildUnifiedEmailTemplate({
    preheader: `Requisition ${statusText}: ${args.requisitionReference}`,
    headerTitle: "Requisition Final Decision",
    headerText: "A requisition request has reached a final decision.",
    greeting: "Hello,",
    messageHtml,
    actionLabel: "Open requisition",
    actionUrl: args.actionUrl,
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Open requisitions",
    showActionUrl: true,
  });
};

const buildNextApproverEmailTemplate = (args: {
  requisitionReference: string;
  requesterName: string;
  departmentName: string;
  actorName: string;
  actionUrl: string;
  submittedDirectlyByRequester: boolean;
}) => {
  const introText = args.submittedDirectlyByRequester
    ? `${escapeEmailHtml(args.actorName)} submitted a requisition and it is now pending your approval.`
    : `${escapeEmailHtml(args.actorName)} has approved a requisition and it is now pending your approval.`;
  const messageHtml = `<p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        ${introText}
                      </p>
                      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Requisition:</strong> ${escapeEmailHtml(args.requisitionReference)}
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Requester:</strong> ${escapeEmailHtml(args.requesterName)}
                      </p>
                      <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #4b5563;">
                        <strong style="color: #080d2d;">Department:</strong> ${escapeEmailHtml(args.departmentName)}
                      </p>`;

  return buildUnifiedEmailTemplate({
    preheader: `Requisition pending approval: ${args.requisitionReference}`,
    headerTitle: "Requisition Pending Your Approval",
    headerText: "A requisition is waiting for your approval action.",
    greeting: "Hello,",
    messageHtml,
    actionLabel: "Review requisition",
    actionUrl: args.actionUrl,
    supportUrl: String(process.env.Frontend_URL || "").trim(),
    supportLabel: "Open requisitions",
    showActionUrl: true,
  });
};

const buildNotificationEmail = (args: {
  eventType: RequisitionNotificationEventType;
  decision: "APPROVED" | "REJECTED" | null;
  requisitionReference: string;
  requesterName: string;
  departmentName: string;
  actorName: string;
  actionUrl: string;
}): { subject: string; html: string } => {
  if (args.eventType === FINAL_APPROVED_EVENT || args.eventType === FINAL_REJECTED_EVENT) {
    const decision = args.decision || (args.eventType === FINAL_APPROVED_EVENT ? "APPROVED" : "REJECTED");
    return {
      subject:
        decision === "APPROVED"
          ? "Requisition Final Approval Decision"
          : "Requisition Final Disapproval Decision",
      html: buildFinalDecisionEmailTemplate({
        decision,
        requisitionReference: args.requisitionReference,
        requesterName: args.requesterName,
        departmentName: args.departmentName,
        actorName: args.actorName,
        actionUrl: args.actionUrl,
      }),
    };
  }

  return {
    subject:
      args.eventType === SUBMITTED_EVENT
        ? "New Requisition Pending Your Approval"
        : "Requisition Pending Your Approval",
    html: buildNextApproverEmailTemplate({
      requisitionReference: args.requisitionReference,
      requesterName: args.requesterName,
      departmentName: args.departmentName,
      actorName: args.actorName,
      actionUrl: args.actionUrl,
      submittedDirectlyByRequester: args.eventType === SUBMITTED_EVENT,
    }),
  };
};

const parseRecipientUserIdsSnapshot = (value: string): number[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return getUniqueSortedPositiveIds(
      parsed
        .map((entry) => toPositiveInt(entry))
        .filter((entry): entry is number => Number.isInteger(entry)),
    );
  } catch (error) {
    return [];
  }
};

let isProcessingNotificationEvents = false;

export const processPendingRequisitionNotificationEvents = async (args?: {
  limit?: number;
}): Promise<void> => {
  if (isProcessingNotificationEvents) {
    return;
  }

  isProcessingNotificationEvents = true;

  try {
    await ensureRequisitionApprovalWorkflowTables();

    const limit =
      Number.isInteger(args?.limit) && (args?.limit || 0) > 0
        ? Math.min(args?.limit || 0, 100)
        : NOTIFICATION_EVENT_BATCH_SIZE;

    const events = await prisma.requisition_notification_events.findMany({
      where: {
        status: {
          in: [
            RequisitionNotificationEventStatus.PENDING,
            RequisitionNotificationEventStatus.FAILED,
          ],
        },
        attempts: {
          lt: NOTIFICATION_EVENT_RETRY_LIMIT,
        },
      },
      orderBy: {
        created_at: "asc",
      },
      take: limit,
      select: {
        id: true,
        event_type: true,
        requisition_id: true,
        actor_user_id: true,
        decision: true,
        recipient_user_ids: true,
      },
    });

    for (const event of events) {
      const claim = await prisma.requisition_notification_events.updateMany({
        where: {
          id: event.id,
          status: {
            in: [
              RequisitionNotificationEventStatus.PENDING,
              RequisitionNotificationEventStatus.FAILED,
            ],
          },
        },
        data: {
          status: RequisitionNotificationEventStatus.PROCESSING,
        },
      });

      if (!claim.count) {
        continue;
      }

      const decision = normalizeDecision(event.decision);

      try {
        if (!isSupportedNotificationEventType(event.event_type)) {
          throw new Error(`Unsupported notification event type: ${event.event_type}`);
        }

        const recipientUserIds = parseRecipientUserIdsSnapshot(
          event.recipient_user_ids,
        );

        if (!recipientUserIds.length) {
          await prisma.requisition_notification_events.update({
            where: { id: event.id },
            data: {
              status: RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS,
              attempts: {
                increment: 1,
              },
              last_error: null,
            },
          });

          if (isFinalDecisionEventType(event.event_type)) {
            emitFinalDecisionMetric({
              metricName:
                "requisition.final_decision_notification.skipped_no_recipients",
              requisitionId: event.requisition_id,
              decision,
              recipientCount: 0,
              actorUserId: event.actor_user_id || null,
            });
          }

          continue;
        }

        const actorUserPromise = event.actor_user_id
          ? prisma.user.findUnique({
              where: {
                id: event.actor_user_id,
              },
              select: {
                name: true,
              },
            })
          : Promise.resolve<null>(null);

        const [requisition, actorUser, recipientUsers] = await Promise.all([
          prisma.request.findUnique({
            where: {
              id: event.requisition_id,
            },
            select: {
              id: true,
              request_id: true,
              user: {
                select: {
                  name: true,
                },
              },
              department: {
                select: {
                  name: true,
                },
              },
            },
          }),
          actorUserPromise,
          prisma.user.findMany({
            where: {
              id: {
                in: recipientUserIds,
              },
              NOT: {
                is_active: false,
              },
            },
            orderBy: {
              id: "asc",
            },
            select: {
              id: true,
              name: true,
              email: true,
            },
          }),
        ]);

        if (!requisition) {
          throw new NotFoundError("Requisition not found for notification event");
        }

        if (!recipientUsers.length) {
          await prisma.requisition_notification_events.update({
            where: { id: event.id },
            data: {
              status: RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS,
              attempts: {
                increment: 1,
              },
              last_error: null,
            },
          });

          if (isFinalDecisionEventType(event.event_type)) {
            emitFinalDecisionMetric({
              metricName:
                "requisition.final_decision_notification.skipped_no_recipients",
              requisitionId: event.requisition_id,
              decision,
              recipientCount: 0,
              actorUserId: event.actor_user_id || null,
            });
          }

          continue;
        }

        const actorName =
          actorUser?.name || (event.event_type === SUBMITTED_EVENT ? "Requester" : "Approver");
        const requisitionReference =
          requisition.request_id || `#${requisition.id}`;
        const requesterName = requisition.user?.name || "Requester";
        const departmentName = requisition.department?.name || "Not specified";
        const requisitionActionUrl = buildRequisitionActionUrl(requisition.id);

        const inAppType =
          event.event_type === SUBMITTED_EVENT
            ? "requisition.submitted"
            : event.event_type === NEXT_APPROVER_EVENT
              ? "requisition.step_advanced"
              : event.event_type === FINAL_APPROVED_EVENT
                ? "requisition.final_approved"
                : "requisition.final_rejected";
        const inAppPriority =
          event.event_type === FINAL_APPROVED_EVENT ||
          event.event_type === FINAL_REJECTED_EVENT
            ? "HIGH"
            : "MEDIUM";
        const inAppTitle =
          event.event_type === SUBMITTED_EVENT
            ? "New requisition awaiting approval"
            : event.event_type === NEXT_APPROVER_EVENT
              ? "Requisition moved to your approval queue"
              : event.event_type === FINAL_APPROVED_EVENT
                ? "Requisition approved"
                : "Requisition rejected";
        const inAppBody =
          event.event_type === SUBMITTED_EVENT
            ? `${requesterName} submitted requisition ${requisitionReference} and it is pending your approval.`
            : event.event_type === NEXT_APPROVER_EVENT
              ? `${actorName} approved requisition ${requisitionReference}. It now requires your approval.`
              : event.event_type === FINAL_APPROVED_EVENT
                ? `Requisition ${requisitionReference} for ${requesterName} was finally approved by ${actorName}.`
                : `Requisition ${requisitionReference} for ${requesterName} was finally rejected by ${actorName}.`;

        const createdNotifications =
          await notificationService.createManyInAppNotifications(
          recipientUsers.map((recipient) => ({
            type: inAppType,
            title: inAppTitle,
            body: inAppBody,
            recipientUserId: recipient.id,
            actorUserId: event.actor_user_id || null,
            entityType: "REQUISITION",
            entityId: String(requisition.id),
            actionUrl: requisitionActionUrl,
            priority: inAppPriority,
            dedupeKey: `requisition:event:${event.id}:recipient:${recipient.id}`,
            sendEmail: false,
            sendSms: true,
            smsBody: inAppBody,
          })),
        );

        const emailEnabledRecipientUserIds =
          await notificationService.filterUserIdsByChannelPreference(
            recipientUsers.map((user) => user.id),
            inAppType,
            "email",
          );
        const emailEnabledRecipientUserIdSet = new Set(emailEnabledRecipientUserIds);

        const recipientEmails = Array.from(
          new Set(
            recipientUsers
              .filter((user) => emailEnabledRecipientUserIdSet.has(user.id))
              .map((user) => user.email?.trim() || "")
              .filter((email): email is string => Boolean(email)),
          ),
        );

        if (recipientEmails.length) {
          const { subject, html } = buildNotificationEmail({
            eventType: event.event_type,
            decision,
            requisitionReference,
            requesterName,
            departmentName,
            actorName,
            actionUrl: toAbsoluteActionUrl(requisitionActionUrl),
          });

          const emailResult = await sendEmail(
            html,
            recipientEmails.join(","),
            subject,
          );

          if (emailResult?.success) {
            const createdNotificationIds = createdNotifications
              .map((notification) => Number(notification.id))
              .filter(
                (notificationId) =>
                  Number.isInteger(notificationId) && notificationId > 0,
              );

            if (createdNotificationIds.length) {
              await prisma.in_app_notification.updateMany({
                where: {
                  id: {
                    in: createdNotificationIds,
                  },
                },
                data: {
                  email_sent_at: new Date(),
                },
              });
            }
          } else if (emailResult?.error) {
            console.error(
              `[requisition-notification-events] email delivery failed for event ${event.id}: ${emailResult.error}`,
            );
          }
        }

        await prisma.requisition_notification_events.update({
          where: {
            id: event.id,
          },
          data: {
            status: RequisitionNotificationEventStatus.SENT,
            sent_at: new Date(),
            attempts: {
              increment: 1,
            },
            last_error: null,
          },
        });

        if (isFinalDecisionEventType(event.event_type)) {
          emitFinalDecisionMetric({
            metricName: "requisition.final_decision_notification.sent",
            requisitionId: event.requisition_id,
            decision,
            recipientCount: recipientUsers.length,
            actorUserId: event.actor_user_id || null,
          });
        }
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error.message : String(error);
        const truncatedError = normalizedError.slice(0, 4000);

        await prisma.requisition_notification_events.update({
          where: {
            id: event.id,
          },
          data: {
            status: RequisitionNotificationEventStatus.FAILED,
            attempts: {
              increment: 1,
            },
            last_error: truncatedError,
          },
        });

        if (
          isSupportedNotificationEventType(event.event_type) &&
          isFinalDecisionEventType(event.event_type)
        ) {
          emitFinalDecisionMetric({
            metricName: "requisition.final_decision_notification.failed",
            requisitionId: event.requisition_id,
            decision,
            recipientCount: parseRecipientUserIdsSnapshot(event.recipient_user_ids)
              .length,
            actorUserId: event.actor_user_id || null,
            error: truncatedError,
          });
        }
      }
    }
  } finally {
    isProcessingNotificationEvents = false;
  }
};

export const triggerRequisitionNotificationEventProcessing = () => {
  void processPendingRequisitionNotificationEvents().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[requisition-notification-events] background processing failed: ${message}`,
    );
    void notificationService.notifyAdminsJobFailed({
      jobName: "requisition-notification-events-trigger",
      errorMessage: message,
      actionUrl: "/home/notifications",
      dedupeKey: `job:requisition-notification-trigger:${new Date().toISOString().slice(0, 13)}`,
    });
  });
};

export const processRequisitionApprovalAction = async (args: {
  requisitionId: number;
  actorUserId: number;
  action: ApprovalAction;
  comment?: string;
}): Promise<RequisitionApprovalActionResult> => {
  const { requisitionId, actorUserId, action, comment } = args;

  const runAction = async (): Promise<RequisitionApprovalActionResult> =>
    prisma.$transaction(async (tx) => {
      const notificationEvents: NotificationEventSummary[] = [];

      const request = await tx.request.findUnique({
        where: {
          id: requisitionId,
        },
        select: {
          id: true,
          user_id: true,
          request_approval_status: true,
        },
      });

      if (!request) {
        throw new NotFoundError("Requisition not found");
      }

      if (request.request_approval_status === RequestApprovalStatus.APPROVED) {
        throw new InputValidationError("Requisition is already approved");
      }

      if (request.request_approval_status === RequestApprovalStatus.REJECTED) {
        throw new InputValidationError("Requisition is already rejected");
      }

      const currentPendingStep = await tx.requisition_approval_instances.findFirst({
        where: {
          request_id: requisitionId,
          status: RequisitionApprovalInstanceStatus.PENDING,
        },
        orderBy: {
          step_order: "asc",
        },
        select: {
          id: true,
          config_id: true,
          approver_user_id: true,
          step_order: true,
        },
      });

      if (!currentPendingStep) {
        throw new InputValidationError(
          "No pending approval step found for this requisition",
        );
      }

      if (currentPendingStep.approver_user_id !== actorUserId) {
        throw new UnauthorizedError(
          "You are not the assigned approver for the current step",
        );
      }

      const maxStepOrderResult = await tx.requisition_approval_instances.aggregate({
        where: {
          request_id: requisitionId,
        },
        _max: {
          step_order: true,
        },
      });
      const maxStepOrder = maxStepOrderResult._max.step_order;
      const isFinalStep =
        typeof maxStepOrder === "number" &&
        currentPendingStep.step_order === maxStepOrder;

      const actionData = {
        acted_by_user_id: actorUserId,
        acted_at: new Date(),
        ...(comment !== undefined && { comment }),
      };

      const createFinalDecisionNotificationEventTx = async (
        decision: "APPROVED" | "REJECTED",
      ) => {
        if (!isFinalStep) {
          return;
        }

        const configNotifications =
          await tx.requisition_approval_config_notifications.findMany({
            where: {
              config_id: currentPendingStep.config_id,
            },
            orderBy: {
              user_id: "asc",
            },
            select: {
              user_id: true,
            },
          });

        const finalRecipientUserIds = await resolveActiveRecipientUserIdsTx(
          tx,
          [
            request.user_id,
            ...configNotifications.map((notification) => notification.user_id),
          ],
          actorUserId,
        );

        const eventType =
          decision === "APPROVED" ? FINAL_APPROVED_EVENT : FINAL_REJECTED_EVENT;
        const createdEvent = await createNotificationEventTx(tx, {
          idempotencyKey: buildFinalDecisionIdempotencyKey(
            requisitionId,
            eventType,
          ),
          eventType,
          requisitionId,
          actorUserId,
          decision,
          recipientUserIds: finalRecipientUserIds,
        });

        if (createdEvent) {
          notificationEvents.push(createdEvent);
        }
      };

      if (action === "REJECT") {
        await tx.requisition_approval_instances.update({
          where: {
            id: currentPendingStep.id,
          },
          data: {
            status: RequisitionApprovalInstanceStatus.REJECTED,
            ...actionData,
          },
        });

        await tx.request.update({
          where: {
            id: requisitionId,
          },
          data: {
            request_approval_status: RequestApprovalStatus.REJECTED,
          },
        });

        await createFinalDecisionNotificationEventTx("REJECTED");
        return { notificationEvents };
      }

      await tx.requisition_approval_instances.update({
        where: {
          id: currentPendingStep.id,
        },
        data: {
          status: RequisitionApprovalInstanceStatus.APPROVED,
          ...actionData,
        },
      });

      const nextStep = await tx.requisition_approval_instances.findFirst({
        where: {
          request_id: requisitionId,
          status: RequisitionApprovalInstanceStatus.WAITING,
          step_order: {
            gt: currentPendingStep.step_order,
          },
        },
        orderBy: {
          step_order: "asc",
        },
        select: {
          id: true,
          step_order: true,
          approver_user_id: true,
        },
      });

      if (nextStep) {
        await tx.requisition_approval_instances.update({
          where: {
            id: nextStep.id,
          },
          data: {
            status: RequisitionApprovalInstanceStatus.PENDING,
          },
        });

        await tx.request.update({
          where: {
            id: requisitionId,
          },
          data: {
            request_approval_status: RequestApprovalStatus.Awaiting_HOD_Approval,
          },
        });

        const nextApproverRecipientUserIds = await resolveActiveRecipientUserIdsTx(
          tx,
          [nextStep.approver_user_id],
          actorUserId,
        );

        const createdEvent = await createNotificationEventTx(tx, {
          idempotencyKey: buildNextApproverIdempotencyKey(
            requisitionId,
            nextStep.step_order,
          ),
          eventType: NEXT_APPROVER_EVENT,
          requisitionId,
          actorUserId,
          recipientUserIds: nextApproverRecipientUserIds,
        });

        if (createdEvent) {
          notificationEvents.push(createdEvent);
        }

        return { notificationEvents };
      }

      await tx.request.update({
        where: {
          id: requisitionId,
        },
        data: {
          request_approval_status: RequestApprovalStatus.APPROVED,
        },
      });

      await createFinalDecisionNotificationEventTx("APPROVED");
      return { notificationEvents };
    });

  let result: RequisitionApprovalActionResult;
  try {
    result = await runAction();
  } catch (error) {
    if (!isRequisitionApprovalTableMissingError(error)) {
      throw error;
    }

    try {
      await ensureRequisitionApprovalWorkflowTables();
      result = await runAction();
    } catch (retryError) {
      if (!isRequisitionApprovalTableMissingError(retryError)) {
        throw retryError;
      }

      throw new InputValidationError(
        "Requisition approval workflow tables are missing. Run database migrations first.",
      );
    }
  }

  for (const event of result.notificationEvents) {
    if (!isFinalDecisionEventType(event.eventType)) {
      continue;
    }

    if (event.recipientCount > 0) {
      emitFinalDecisionMetric({
        metricName: "requisition.final_decision_notification.created",
        requisitionId,
        decision: event.decision,
        recipientCount: event.recipientCount,
        actorUserId: event.actorUserId,
      });
      continue;
    }

    emitFinalDecisionMetric({
      metricName: "requisition.final_decision_notification.skipped_no_recipients",
      requisitionId,
      decision: event.decision,
      recipientCount: event.recipientCount,
      actorUserId: event.actorUserId,
    });
  }

  triggerRequisitionNotificationEventProcessing();
  return result;
};

export const canUserManageRequisitionByApproverRole = async (
  userId: number,
): Promise<boolean> => {
  if (!Number.isInteger(userId) || userId <= 0) {
    return false;
  }

  try {
    const [activeConfig, userRecord, pendingAssignment] = await prisma.$transaction([
      prisma.requisition_approval_configs.findUnique({
        where: {
          module: REQUISITION_MODULE,
        },
        select: {
          is_active: true,
          steps: {
            select: {
              step_type: true,
              position_id: true,
              user_id: true,
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          position_id: true,
        },
      }),
      prisma.requisition_approval_instances.findFirst({
        where: {
          approver_user_id: userId,
          status: RequisitionApprovalInstanceStatus.PENDING,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (pendingAssignment) {
      return true;
    }

    if (!activeConfig || !activeConfig.is_active) {
      return false;
    }

    const hasSpecificPersonStep = activeConfig.steps.some(
      (step) =>
        step.step_type === RequisitionApproverType.SPECIFIC_PERSON &&
        step.user_id === userId,
    );
    if (hasSpecificPersonStep) {
      return true;
    }

    const hasPositionStep = activeConfig.steps.some(
      (step) =>
        step.step_type === RequisitionApproverType.POSITION &&
        step.position_id !== null &&
        step.position_id === userRecord?.position_id,
    );
    if (hasPositionStep) {
      return true;
    }

    const hasHeadOfDepartmentStep = activeConfig.steps.some(
      (step) => step.step_type === RequisitionApproverType.HEAD_OF_DEPARTMENT,
    );
    if (!hasHeadOfDepartmentStep) {
      return false;
    }

    const isDepartmentHead = await prisma.department.findFirst({
      where: {
        department_head: userId,
      },
      select: {
        id: true,
      },
    });

    return Boolean(isDepartmentHead);
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      return false;
    }
    throw error;
  }
};
