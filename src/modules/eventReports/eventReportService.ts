import {
  EventReportFinanceRole,
  EventReportSectionApprovalStatus,
  EventReportStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { notificationService } from "../notifications/notificationService";
import {
  buildAttendanceVisitorCountsMap,
  getAttendanceVisitorCountsForRecord,
} from "../events/attendanceVisitorCounts";

type EventReportNotificationEventType =
  | "event_report.submitted_for_final_approval"
  | "event_report.final_approved"
  | "event_report.final_rejected";

type EventReportAction = "APPROVE" | "REJECT";

type EventReportApproverType =
  | "HEAD_OF_DEPARTMENT"
  | "POSITION"
  | "SPECIFIC_PERSON";

type EventReportFinalApprovalStepStatus =
  | "WAITING"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

type EventReportNotificationQueueStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "SKIPPED_NO_RECIPIENTS";

type ApprovalWorkflowTx = Prisma.TransactionClient;

type FinanceItem = {
  id: string;
  name: string;
  amount: number;
};

type DepartmentLinkedUser = {
  department_id: number | null;
  department: {
    department_id: number | null;
  } | null;
  department_positions: Array<{
    department_id: number;
  }>;
};

type DepartmentMemberInfo = {
  user_id: number;
  name: string;
};

type DepartmentAttendanceDetail = {
  id: number | null;
  user_id: number;
  name: string;
  arrival_time: string | null;
  reported_time: string;
  relative_to_start: string;
  status: "early" | "on_time" | "late" | "absent";
};

type ApprovalBlock = {
  status: string;
  approved_by_user_id: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  can_current_user_approve: boolean;
};

type NotificationEventSummary = {
  id: number;
  eventType: EventReportNotificationEventType;
  recipientCount: number;
  actorUserId: number | null;
};

type EventReportApprovalConfigPayload = {
  module?: unknown;
  requester_user_ids?: unknown;
  notification_user_ids?: unknown;
  similar_item_lookback_days?: unknown;
  approvers?: unknown;
  finance_approver?: unknown;
  is_active?: unknown;
};

type EventReportApprovalConfigResponse = {
  module: "EVENT_REPORT";
  requester_user_ids: number[];
  notification_user_ids: number[];
  similar_item_lookback_days: number;
  approvers: Array<{
    order: number;
    type: EventReportApproverType;
    position_id?: number;
    user_id?: number;
  }>;
  finance_approver: {
    type: EventReportApproverType;
    position_id?: number;
    user_id?: number;
  } | null;
  is_active: boolean;
};

type NormalizedApproverDefinition = {
  type: EventReportApproverType;
  positionId: number | null;
  userId: number | null;
};

type NormalizedApproverStep = NormalizedApproverDefinition & {
  order: number;
};

type NormalizedEventReportApprovalConfig = {
  notificationUserIds: number[];
  similarItemLookbackDays: number;
  approvers: NormalizedApproverStep[];
  financeApprover: NormalizedApproverDefinition | null;
  isActive: boolean;
};

const EVENT_REPORT_MODULE = "EVENT_REPORT" as const;
const APPROVER_TYPE = {
  HEAD_OF_DEPARTMENT: "HEAD_OF_DEPARTMENT",
  POSITION: "POSITION",
  SPECIFIC_PERSON: "SPECIFIC_PERSON",
} as const;
const FINAL_APPROVAL_STEP_STATUS = {
  WAITING: "WAITING",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
const NOTIFICATION_QUEUE_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SENT: "SENT",
  FAILED: "FAILED",
  SKIPPED_NO_RECIPIENTS: "SKIPPED_NO_RECIPIENTS",
} as const;
const DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS = 30;
const MAX_NOTIFICATION_RECIPIENTS = 50;
const MANAGE_PERMISSION_VALUES = ["Can_Manage", "Super_Admin"];
const NOTIFICATION_EVENT_RETRY_LIMIT = 5;
const NOTIFICATION_EVENT_BATCH_SIZE = 5;
const FINAL_SUBMIT_EVENT: EventReportNotificationEventType =
  "event_report.submitted_for_final_approval";
const FINAL_APPROVED_EVENT: EventReportNotificationEventType =
  "event_report.final_approved";
const FINAL_REJECTED_EVENT: EventReportNotificationEventType =
  "event_report.final_rejected";
const SINGLE_FINANCE_APPROVAL_ROLE = EventReportFinanceRole.FINANCE_REP;

const EVENT_REPORT_TABLE_NAMES = [
  "event_reports",
  "event_report_department_approvals",
  "event_report_attendance_approval",
  "event_report_finance",
  "event_report_finance_approvals",
  "event_report_viewers",
  "event_report_final_approval_instances",
  "event_report_notification_events",
  "requisition_approval_configs",
  "requisition_approval_config_requesters",
  "requisition_approval_config_steps",
  "requisition_approval_config_notifications",
];

export const saveEventReportApprovalConfig = async (
  payload: EventReportApprovalConfigPayload,
  actorUserId?: number,
) => {
  const normalizedPayload = normalizeEventReportApprovalConfigPayload(payload);

  const runUpsert = async () =>
    runEventReportTransaction(async (tx) => {
      await verifyEventReportApprovalConfigReferencesTx(tx, normalizedPayload);

      const config = await tx.requisition_approval_configs.upsert({
        where: {
          module: EVENT_REPORT_MODULE,
        },
        update: {
          is_active: normalizedPayload.isActive,
          similar_item_lookback_days: normalizedPayload.similarItemLookbackDays,
          finance_approver_type: normalizedPayload.financeApprover?.type || null,
          finance_position_id: normalizedPayload.financeApprover?.positionId || null,
          finance_user_id: normalizedPayload.financeApprover?.userId || null,
          updated_by: actorUserId,
        },
        create: {
          module: EVENT_REPORT_MODULE,
          is_active: normalizedPayload.isActive,
          similar_item_lookback_days: normalizedPayload.similarItemLookbackDays,
          finance_approver_type: normalizedPayload.financeApprover?.type || null,
          finance_position_id: normalizedPayload.financeApprover?.positionId || null,
          finance_user_id: normalizedPayload.financeApprover?.userId || null,
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

      const savedConfig = await getStoredEventReportApprovalConfigTx(tx);
      if (!savedConfig) {
        throw new NotFoundError("Unable to load event report approval config");
      }

      return mapEventReportApprovalConfigResponse(savedConfig);
    });

  try {
    return await runUpsert();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report approval tables are missing. Run database migrations first.",
    );
  }
};

export const fetchEventReportApprovalConfig = async () => {
  const runFetch = async () =>
    runEventReportTransaction(async (tx) => {
      const config = await getStoredEventReportApprovalConfigTx(tx);
      if (!config) {
        return null;
      }

      return mapEventReportApprovalConfigResponse(config);
    });

  try {
    return await runFetch();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    return null;
  }
};

const isEventReportTableMissingError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2021") {
    return false;
  }

  const tableFromMeta =
    typeof error.meta?.table === "string" ? error.meta.table : "";
  const fullMessage = `${error.message} ${tableFromMeta}`;

  return EVENT_REPORT_TABLE_NAMES.some((tableName) =>
    fullMessage.includes(tableName),
  );
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

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const EVENT_REPORT_TX_MAX_WAIT_MS =
  toPositiveInt(process.env.EVENT_REPORT_TX_MAX_WAIT_MS) || 10_000;
const EVENT_REPORT_TX_TIMEOUT_MS =
  toPositiveInt(process.env.EVENT_REPORT_TX_TIMEOUT_MS) || 90_000;

const runEventReportTransaction = async <T>(
  operation: (tx: ApprovalWorkflowTx) => Promise<T>,
): Promise<T> =>
  prisma.$transaction((tx) => operation(tx), {
    maxWait: EVENT_REPORT_TX_MAX_WAIT_MS,
    timeout: EVENT_REPORT_TX_TIMEOUT_MS,
  });

const normalizePermissionPayload = (
  permissions: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject | null => {
  if (!permissions) {
    return null;
  }

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) {
      return null;
    }

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions) as Prisma.JsonValue;
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Prisma.JsonObject;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  if (
    permissions &&
    typeof permissions === "object" &&
    !Array.isArray(permissions)
  ) {
    return permissions as Prisma.JsonObject;
  }

  return null;
};

const hasPermissionValue = (
  permissions: Prisma.JsonValue | null | undefined,
  permissionKeys: string[],
  acceptedValues: string[] = MANAGE_PERMISSION_VALUES,
): boolean => {
  const normalized = normalizePermissionPayload(permissions);
  if (!normalized) {
    return false;
  }

  return permissionKeys.some((key) => {
    const value = normalized[key];
    return typeof value === "string" && acceptedValues.includes(value);
  });
};

const isSuperAdmin = (
  permissions: Prisma.JsonValue | null | undefined,
): boolean => {
  const normalized = normalizePermissionPayload(permissions);
  if (!normalized) {
    return false;
  }

  return Object.values(normalized).some(
    (value) => typeof value === "string" && value === "Super_Admin",
  );
};

const getAuthenticatedUserId = (user: any): number => {
  const actorUserId = toPositiveInt(user?.id);
  if (!actorUserId) {
    throw new UnauthorizedError("Authenticated user not found");
  }

  return actorUserId;
};

const parseEventDateString = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  const utcDate = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(utcDate.getTime())) {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  return trimmed;
};

const toUtcDayDate = (dateString: string): Date =>
  new Date(`${dateString}T00:00:00.000Z`);

const toYmdDateString = (value: Date): string => value.toISOString().slice(0, 10);

const getUtcDayBounds = (dateString: string) => {
  const start = toUtcDayDate(dateString);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
};

const toIsoStringOrNull = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const uniquePositiveIds = (values: number[]): number[] =>
  Array.from(
    new Set(
      values.filter((value) => Number.isInteger(value) && value > 0),
    ),
  ).sort((first, second) => first - second);

const getUserDepartmentIds = (
  user: DepartmentLinkedUser,
  validDepartmentIdSet: Set<number>,
): number[] => {
  const departmentIds = new Set<number>();

  if (
    typeof user.department?.department_id === "number" &&
    validDepartmentIdSet.has(user.department.department_id)
  ) {
    departmentIds.add(user.department.department_id);
  }

  if (
    typeof user.department_id === "number" &&
    validDepartmentIdSet.has(user.department_id)
  ) {
    departmentIds.add(user.department_id);
  }

  for (const departmentPosition of user.department_positions) {
    if (validDepartmentIdSet.has(departmentPosition.department_id)) {
      departmentIds.add(departmentPosition.department_id);
    }
  }

  return Array.from(departmentIds).sort((first, second) => first - second);
};

const buildReportEventStartDateTime = (
  eventDate: string,
  eventStartTime: string | null | undefined,
  eventStartDate: Date | null | undefined,
): Date | null => {
  const reportEventStart = toUtcDayDate(eventDate);
  const normalizedStartTime = String(eventStartTime || "").trim();
  const timeMatch = normalizedStartTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (timeMatch) {
    reportEventStart.setUTCHours(
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] || 0),
      0,
    );
    return reportEventStart;
  }

  if (!eventStartDate) {
    return null;
  }

  reportEventStart.setUTCHours(
    eventStartDate.getUTCHours(),
    eventStartDate.getUTCMinutes(),
    eventStartDate.getUTCSeconds(),
    eventStartDate.getUTCMilliseconds(),
  );

  return reportEventStart;
};

const formatReportedTime = (value: Date | null | undefined): string | null => {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString().slice(11, 19);
};

const formatRelativeToStart = (
  arrivalTime: Date,
  eventStartTime: Date | null,
): string => {
  if (!eventStartTime) {
    return "-";
  }

  const differenceInMinutes = Math.round(
    (arrivalTime.getTime() - eventStartTime.getTime()) / 60000,
  );

  if (differenceInMinutes === 0) {
    return "0m";
  }

  const absoluteMinutes = Math.abs(differenceInMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const parts = [
    ...(hours ? [`${hours}h`] : []),
    ...(minutes || !hours ? [`${minutes}m`] : []),
  ];

  return `${differenceInMinutes > 0 ? "+" : "-"}${parts.join(" ")}`;
};

const getReportedAttendanceStatus = (
  arrivalTime: Date,
  eventStartTime: Date | null,
): "early" | "on_time" | "late" => {
  if (!eventStartTime) {
    return "on_time";
  }

  if (arrivalTime.getTime() < eventStartTime.getTime()) {
    return "early";
  }

  if (arrivalTime.getTime() > eventStartTime.getTime()) {
    return "late";
  }

  return "on_time";
};

const getExistingDepartmentIdSetTx = async (
  tx: ApprovalWorkflowTx,
  departmentIds: number[],
): Promise<Set<number>> => {
  const uniqueDepartmentIds = uniquePositiveIds(departmentIds);
  if (!uniqueDepartmentIds.length) {
    return new Set<number>();
  }

  const rows = await tx.department.findMany({
    where: {
      id: {
        in: uniqueDepartmentIds,
      },
    },
    select: {
      id: true,
    },
  });

  return new Set(rows.map((row) => row.id));
};

const getDepartmentMembersByDepartmentTx = async (
  tx: ApprovalWorkflowTx,
  validDepartmentIdSet: Set<number>,
) => {
  const users = await tx.user.findMany({
    select: {
      id: true,
      name: true,
      department_id: true,
      department: {
        select: {
          department_id: true,
        },
      },
      department_positions: {
        select: {
          department_id: true,
        },
      },
    },
  });

  const membersByDepartment = new Map<number, Map<number, DepartmentMemberInfo>>();

  for (const user of users) {
    const departmentIds = getUserDepartmentIds(user, validDepartmentIdSet);

    for (const departmentId of departmentIds) {
      const members = membersByDepartment.get(departmentId) || new Map();
      members.set(user.id, {
        user_id: user.id,
        name: user.name,
      });
      membersByDepartment.set(departmentId, members);
    }
  }

  return membersByDepartment;
};

const parseNotificationUserIds = (value: unknown): number[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InputValidationError(
      "notification_user_ids must be an array when provided",
    );
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

const parseEventReportApproverDefinition = (
  value: unknown,
  fieldPath: string,
): NormalizedApproverDefinition => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputValidationError(`${fieldPath} must be an object`);
  }

  const step = value as {
    type?: unknown;
    position_id?: unknown;
    user_id?: unknown;
  };

  if (typeof step.type !== "string") {
    throw new InputValidationError(`${fieldPath}.type is required`);
  }

  const type = step.type.trim().toUpperCase() as EventReportApproverType;
  if (!Object.values(APPROVER_TYPE).includes(type)) {
    throw new InputValidationError(
      `${fieldPath}.type must be one of HEAD_OF_DEPARTMENT, POSITION, SPECIFIC_PERSON`,
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
      `${fieldPath}.position_id must be a positive integer when provided`,
    );
  }

  if (step.user_id !== undefined && step.user_id !== null && !userId) {
    throw new InputValidationError(
      `${fieldPath}.user_id must be a positive integer when provided`,
    );
  }

  if (type === APPROVER_TYPE.HEAD_OF_DEPARTMENT) {
    if (positionId !== null || userId !== null) {
      throw new InputValidationError(
        `${fieldPath} HEAD_OF_DEPARTMENT must not include position_id or user_id`,
      );
    }
  }

  if (type === APPROVER_TYPE.POSITION) {
    if (!positionId) {
      throw new InputValidationError(
        `${fieldPath} POSITION must include position_id`,
      );
    }

    if (userId !== null) {
      throw new InputValidationError(
        `${fieldPath} POSITION must not include user_id`,
      );
    }
  }

  if (type === APPROVER_TYPE.SPECIFIC_PERSON) {
    if (!userId) {
      throw new InputValidationError(
        `${fieldPath} SPECIFIC_PERSON must include user_id`,
      );
    }

    if (positionId !== null) {
      throw new InputValidationError(
        `${fieldPath} SPECIFIC_PERSON must not include position_id`,
      );
    }
  }

  return {
    type,
    positionId,
    userId,
  };
};

const parseEventReportApprovers = (value: unknown): NormalizedApproverStep[] => {
  if (!Array.isArray(value) || !value.length) {
    throw new InputValidationError("approvers must be a non-empty array");
  }

  const parsed = value.map((rawStep, index) => {
    if (typeof rawStep !== "object" || rawStep === null || Array.isArray(rawStep)) {
      throw new InputValidationError(`approvers[${index}] must be an object`);
    }

    const step = rawStep as {
      order?: unknown;
    };

    const order = toPositiveInt(step.order);
    if (!order) {
      throw new InputValidationError(
        `approvers[${index}].order must be a positive integer`,
      );
    }
    const approver = parseEventReportApproverDefinition(
      rawStep,
      `approvers[${index}]`,
    );

    return {
      order,
      ...approver,
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

const parseEventReportFinanceApprover = (
  value: unknown,
): NormalizedApproverDefinition | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseEventReportApproverDefinition(value, "finance_approver");
};

const normalizeEventReportApprovalConfigPayload = (
  payload: EventReportApprovalConfigPayload,
): NormalizedEventReportApprovalConfig => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InputValidationError("Invalid payload");
  }

  const requestedModule = payload.module;
  if (requestedModule !== undefined && requestedModule !== null) {
    const normalizedModuleValue =
      typeof requestedModule === "string"
        ? requestedModule.trim().toUpperCase()
        : "";
    if (normalizedModuleValue !== EVENT_REPORT_MODULE) {
      throw new InputValidationError(
        "module must be EVENT_REPORT when provided",
      );
    }
  }

  let isActive = true;
  if (payload.is_active !== undefined) {
    if (typeof payload.is_active !== "boolean") {
      throw new InputValidationError("is_active must be boolean when provided");
    }
    isActive = payload.is_active;
  }

  return {
    notificationUserIds: parseNotificationUserIds(payload.notification_user_ids),
    similarItemLookbackDays: parseSimilarItemLookbackDays(
      payload.similar_item_lookback_days,
    ),
    approvers: parseEventReportApprovers(payload.approvers),
    financeApprover: parseEventReportFinanceApprover(payload.finance_approver),
    isActive,
  };
};

const verifyEventReportApprovalConfigReferencesTx = async (
  tx: ApprovalWorkflowTx,
  payload: NormalizedEventReportApprovalConfig,
): Promise<void> => {
  const specificApproverUserIds = payload.approvers
    .map((step) => step.userId)
    .filter((id): id is number => Number.isInteger(id));
  const financeApproverUserId = payload.financeApprover?.userId;

  const userIdsToCheck = Array.from(
    new Set(
      [
        ...specificApproverUserIds,
        ...payload.notificationUserIds,
        financeApproverUserId,
      ].filter((id): id is number => Number.isInteger(id)),
    ),
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
      [
        ...payload.approvers
          .map((step) => step.positionId)
          .filter((id): id is number => Number.isInteger(id)),
        payload.financeApprover?.positionId,
      ].filter((id): id is number => Number.isInteger(id)),
    ),
  );

  if (!positionIdsToCheck.length) {
    return;
  }

  const positions = await tx.position.findMany({
    where: {
      id: {
        in: positionIdsToCheck,
      },
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

const getStoredEventReportApprovalConfigTx = async (tx: ApprovalWorkflowTx) => {
  return tx.requisition_approval_configs.findUnique({
    where: {
      module: EVENT_REPORT_MODULE,
    },
    select: {
      id: true,
      module: true,
      is_active: true,
      similar_item_lookback_days: true,
      finance_approver_type: true,
      finance_position_id: true,
      finance_user_id: true,
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
};

const mapEventReportApprovalConfigResponse = (config: {
  id: number;
  module: string;
  is_active: boolean;
  similar_item_lookback_days: number;
  finance_approver_type: string | null;
  finance_position_id: number | null;
  finance_user_id: number | null;
  notifications: Array<{ user_id: number }>;
  steps: Array<{
    step_order: number;
    step_type: string;
    position_id: number | null;
    user_id: number | null;
  }>;
}): EventReportApprovalConfigResponse => {
  const similarItemLookbackDays =
    toPositiveInt(config.similar_item_lookback_days) ||
    DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS;

  return {
    module: EVENT_REPORT_MODULE,
    requester_user_ids: [],
    notification_user_ids: config.notifications.map(
      (notification) => notification.user_id,
    ),
    similar_item_lookback_days: similarItemLookbackDays,
    approvers: config.steps.map((step) => ({
      order: step.step_order,
      type: step.step_type as EventReportApproverType,
      ...(step.position_id !== null && { position_id: step.position_id }),
      ...(step.user_id !== null && { user_id: step.user_id }),
    })),
    finance_approver: config.finance_approver_type
      ? {
          type: config.finance_approver_type as EventReportApproverType,
          ...(config.finance_position_id !== null && {
            position_id: config.finance_position_id,
          }),
          ...(config.finance_user_id !== null && {
            user_id: config.finance_user_id,
          }),
        }
      : null,
    is_active: config.is_active,
  };
};

const parseApprovalAction = (value: unknown): "APPROVE" => {
  if (value !== "APPROVE") {
    throw new InputValidationError("action must be APPROVE");
  }

  return "APPROVE";
};

const parseFinalApprovalAction = (value: unknown): EventReportAction => {
  if (value !== "APPROVE" && value !== "REJECT") {
    throw new InputValidationError("action must be APPROVE or REJECT");
  }

  return value;
};

const parseOptionalComment = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InputValidationError("comment must be a string when provided");
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalizeFinanceItems = (
  value: unknown,
  kind: "income" | "expense",
): FinanceItem[] => {
  if (!Array.isArray(value)) {
    throw new InputValidationError(`${kind} must be an array`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new InputValidationError(`${kind}[${index}] must be an object`);
    }

    const item = entry as {
      id?: unknown;
      name?: unknown;
      amount?: unknown;
    };

    const name = String(item.name || "").trim();
    if (!name) {
      throw new InputValidationError(`${kind}[${index}].name is required`);
    }

    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new InputValidationError(`${kind}[${index}].amount must be a non-negative number`);
    }

    const idCandidate =
      typeof item.id === "string" && item.id.trim().length
        ? item.id.trim()
        : `${kind}-${index + 1}-${randomUUID().slice(0, 8)}`;

    return {
      id: idCandidate,
      name,
      amount,
    };
  });
};

const parseStoredFinanceItems = (value: string, kind: "income" | "expense"): FinanceItem[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const item = entry as {
          id?: unknown;
          name?: unknown;
          amount?: unknown;
        };

        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name) {
          return null;
        }

        const amount = Number(item.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return null;
        }

        const idCandidate =
          typeof item.id === "string" && item.id.trim().length
            ? item.id.trim()
            : `${kind}-${index + 1}`;

        return {
          id: idCandidate,
          name,
          amount,
        };
      })
      .filter((item): item is FinanceItem => Boolean(item));
  } catch (error) {
    return [];
  }
};

const buildEventReportActionUrl = (eventId: number, eventDate: string): string =>
  `/home/reports/event-reports/${eventId}?eventDate=${eventDate}`;

const resolveActiveRecipientUserIdsTx = async (
  tx: ApprovalWorkflowTx,
  candidateUserIds: number[],
  actorUserId?: number,
): Promise<number[]> => {
  const uniqueCandidateUserIds = uniquePositiveIds(candidateUserIds);
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

const loadEventByIdTx = async (tx: ApprovalWorkflowTx, eventId: number) => {
  const event = await tx.event_mgt.findUnique({
    where: {
      id: eventId,
    },
    select: {
      id: true,
      created_by: true,
      start_date: true,
      start_time: true,
      event: {
        select: {
          event_name: true,
        },
      },
    },
  });

  if (!event) {
    throw new NotFoundError("Event not found");
  }

  return event;
};

const resolveEventDateForReportTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate?: string;
    eventStartDate?: Date | null;
  },
): Promise<string> => {
  if (args.eventDate) {
    return parseEventDateString(args.eventDate);
  }

  const latestReport = await tx.event_reports.findFirst({
    where: {
      event_id: args.eventId,
    },
    orderBy: {
      event_date: "desc",
    },
    select: {
      event_date: true,
    },
  });

  if (latestReport?.event_date) {
    return toYmdDateString(latestReport.event_date);
  }

  const latestAttendance = await tx.event_attendance_summary.findFirst({
    where: {
      event_mgt_id: args.eventId,
    },
    orderBy: {
      date: "desc",
    },
    select: {
      date: true,
    },
  });

  if (latestAttendance?.date) {
    return toYmdDateString(latestAttendance.date);
  }

  if (args.eventStartDate) {
    return toYmdDateString(args.eventStartDate);
  }

  return toYmdDateString(new Date());
};

const findEventReportByDateTx = async (
  tx: ApprovalWorkflowTx,
  eventId: number,
  eventDate: string,
) => {
  const { start, end } = getUtcDayBounds(eventDate);

  return tx.event_reports.findFirst({
    where: {
      event_id: eventId,
      event_date: {
        gte: start,
        lt: end,
      },
    },
    select: {
      id: true,
      event_id: true,
      event_date: true,
      status: true,
      final_approver_user_id: true,
      final_acted_by_user_id: true,
      final_acted_at: true,
      created_by: true,
      updated_by: true,
      created_at: true,
      updated_at: true,
    },
  });
};

const ensureEventReportTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
    actorUserId: number;
    reportOwnerUserId?: number;
  },
) => {
  const existing = await findEventReportByDateTx(tx, args.eventId, args.eventDate);
  if (existing) {
    return existing;
  }

  const reportOwnerUserId =
    toPositiveInt(args.reportOwnerUserId) || args.actorUserId;

  try {
    return await tx.event_reports.create({
      data: {
        event_id: args.eventId,
        event_date: toUtcDayDate(args.eventDate),
        status: EventReportStatus.DRAFT,
        created_by: reportOwnerUserId,
        updated_by: args.actorUserId,
      },
      select: {
        id: true,
        event_id: true,
        event_date: true,
        status: true,
        final_approver_user_id: true,
        final_acted_by_user_id: true,
        final_acted_at: true,
        created_by: true,
        updated_by: true,
        created_at: true,
        updated_at: true,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const created = await findEventReportByDateTx(tx, args.eventId, args.eventDate);
      if (created) {
        return created;
      }
    }

    throw error;
  }
};

const ensureAttendanceApprovalRowTx = async (
  tx: ApprovalWorkflowTx,
  eventReportId: number,
) => {
  const existing = await tx.event_report_attendance_approval.findUnique({
    where: {
      event_report_id: eventReportId,
    },
    include: {
      approved_by_user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (existing) {
    return existing;
  }

  return tx.event_report_attendance_approval.create({
    data: {
      event_report_id: eventReportId,
      status: EventReportSectionApprovalStatus.PENDING,
    },
    include: {
      approved_by_user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

const ensureFinanceRowTx = async (
  tx: ApprovalWorkflowTx,
  eventReportId: number,
) => {
  const existing = await tx.event_report_finance.findUnique({
    where: {
      event_report_id: eventReportId,
    },
  });

  if (existing) {
    return existing;
  }

  return tx.event_report_finance.create({
    data: {
      event_report_id: eventReportId,
      income_json: JSON.stringify([]),
      expense_json: JSON.stringify([]),
      total_income: 0,
      total_expense: 0,
      surplus: 0,
    },
  });
};

const pickPrimaryFinanceApprovalRow = <T extends {
  role: EventReportFinanceRole;
  status: EventReportSectionApprovalStatus;
}>(rows: T[]): T | null => {
  if (!rows.length) {
    return null;
  }

  return (
    rows.find((row) => row.status === EventReportSectionApprovalStatus.APPROVED) ||
    rows.find((row) => row.role === SINGLE_FINANCE_APPROVAL_ROLE) ||
    rows[0]
  );
};

const ensureDepartmentApprovalRowsTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    departmentIds: number[];
  },
) => {
  const uniqueDepartmentIds = uniquePositiveIds(args.departmentIds);
  if (!uniqueDepartmentIds.length) {
    return;
  }

  const validDepartmentIdSet = await getExistingDepartmentIdSetTx(
    tx,
    uniqueDepartmentIds,
  );
  const validDepartmentIds = uniqueDepartmentIds.filter((departmentId) =>
    validDepartmentIdSet.has(departmentId),
  );
  if (!validDepartmentIds.length) {
    return;
  }

  const existingRows = await tx.event_report_department_approvals.findMany({
    where: {
      event_report_id: args.eventReportId,
      department_id: {
        in: validDepartmentIds,
      },
    },
    select: {
      department_id: true,
    },
  });

  const existingApprovalDepartmentIdSet = new Set(
    existingRows.map((row) => row.department_id),
  );

  const missingDepartmentIds = validDepartmentIds.filter(
    (departmentId) => !existingApprovalDepartmentIdSet.has(departmentId),
  );

  if (!missingDepartmentIds.length) {
    return;
  }

  await tx.event_report_department_approvals.createMany({
    data: missingDepartmentIds.map((departmentId) => ({
      event_report_id: args.eventReportId,
      department_id: departmentId,
      status: EventReportSectionApprovalStatus.PENDING,
    })),
  });
};

const syncEventReportViewersTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    userIds: number[];
  },
) => {
  const uniqueUserIds = uniquePositiveIds(args.userIds);

  if (!uniqueUserIds.length) {
    await tx.event_report_viewers.deleteMany({
      where: {
        event_report_id: args.eventReportId,
      },
    });
    return;
  }

  await tx.event_report_viewers.deleteMany({
    where: {
      event_report_id: args.eventReportId,
      user_id: {
        notIn: uniqueUserIds,
      },
    },
  });

  await tx.event_report_viewers.createMany({
    data: uniqueUserIds.map((userId) => ({
      event_report_id: args.eventReportId,
      user_id: userId,
    })),
    skipDuplicates: true,
  });
};

const getChurchAttendanceApproverUserIdsTx = async (
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
    .filter(
      (user) =>
        hasPermissionValue(user.access?.permissions, [
          "Church_Attendance",
          "Church Attendance",
          "Events",
        ]) || isSuperAdmin(user.access?.permissions),
    )
    .map((user) => user.id);
};

const getActiveEventReportApprovalConfigTx = async (
  tx: ApprovalWorkflowTx,
) => {
  const config = await getStoredEventReportApprovalConfigTx(tx);

  if (!config || !config.is_active) {
    throw new InputValidationError(
      "No active approval config found for module EVENT_REPORT",
    );
  }

  if (!config.steps.length) {
    throw new InputValidationError(
      "Active EVENT_REPORT approval config has no approver steps",
    );
  }

  return config;
};

const getEventReportApprovalConfigOrNullTx = async (
  tx: ApprovalWorkflowTx,
) => {
  const config = await getStoredEventReportApprovalConfigTx(tx);

  if (!config || !config.is_active) {
    return null;
  }

  return config;
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

  let departmentId = requesterDepartment?.department_id || fallbackDepartmentId || null;

  if (!departmentId) {
    const requester = await tx.user.findUnique({
      where: {
        id: requesterId,
      },
      select: {
        department_id: true,
      },
    });

    departmentId = requester?.department_id || null;
  }

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
    orderBy: {
      id: "asc",
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
      step_type: EventReportApproverType;
      position_id: number | null;
      user_id: number | null;
    };
    requesterId: number;
  },
): Promise<number> => {
  const { step, requesterId } = args;

  if (step.step_type === APPROVER_TYPE.HEAD_OF_DEPARTMENT) {
    return resolveHeadOfDepartmentApproverUserId(tx, requesterId);
  }

  if (step.step_type === APPROVER_TYPE.POSITION) {
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

const getConfiguredFinanceApproverStepTx = async (
  tx: ApprovalWorkflowTx,
) => {
  const config = await getStoredEventReportApprovalConfigTx(tx);

  if (!config?.finance_approver_type) {
    return null;
  }

  return {
    step_type: config.finance_approver_type as EventReportApproverType,
    position_id: config.finance_position_id,
    user_id: config.finance_user_id,
  };
};

const resolveConfiguredFinanceApproverUserIdTx = async (
  tx: ApprovalWorkflowTx,
  requesterId: number,
): Promise<number | null> => {
  const financeApproverStep = await getConfiguredFinanceApproverStepTx(tx);
  if (!financeApproverStep) {
    return null;
  }

  try {
    return await resolveApproverUserIdForStep(tx, {
      step: financeApproverStep,
      requesterId,
    });
  } catch (error) {
    if (error instanceof InputValidationError) {
      return null;
    }

    throw error;
  }
};

const ensureFinanceApprovalRowTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    requesterId: number;
  },
) => {
  const existingRows = await tx.event_report_finance_approvals.findMany({
    where: {
      event_report_id: args.eventReportId,
    },
    orderBy: [
      {
        approved_at: "desc",
      },
      {
        id: "asc",
      },
    ],
    include: {
      role_owner_user: {
        select: {
          id: true,
          name: true,
        },
      },
      approved_by_user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const resolvedApproverUserId = await resolveConfiguredFinanceApproverUserIdTx(
    tx,
    args.requesterId,
  );

  const primaryRow = pickPrimaryFinanceApprovalRow(existingRows);
  if (!primaryRow) {
    return tx.event_report_finance_approvals.create({
      data: {
        event_report_id: args.eventReportId,
        role: SINGLE_FINANCE_APPROVAL_ROLE,
        role_owner_user_id: resolvedApproverUserId,
        status: EventReportSectionApprovalStatus.PENDING,
      },
      include: {
        role_owner_user: {
          select: {
            id: true,
            name: true,
          },
        },
        approved_by_user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  if (
    primaryRow.status !== EventReportSectionApprovalStatus.APPROVED &&
    primaryRow.role_owner_user_id !== resolvedApproverUserId
  ) {
    return tx.event_report_finance_approvals.update({
      where: {
        id: primaryRow.id,
      },
      data: {
        role_owner_user_id: resolvedApproverUserId,
      },
      include: {
        role_owner_user: {
          select: {
            id: true,
            name: true,
          },
        },
        approved_by_user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  return primaryRow;
};

const isAdminLikeUser = (user: any): boolean => {
  const permissions = user?.permissions as Prisma.JsonValue | null | undefined;

  if (isSuperAdmin(permissions)) {
    return true;
  }

  return hasPermissionValue(permissions, [
    "Settings",
    "Events",
    "Financials",
    "Church_Attendance",
    "Church Attendance",
  ]);
};

const canUserSubmitFinal = (args: {
  actorUserId: number;
  actorUser: any;
  reportOwnerUserId: number;
  configuredRequesterUserIds: number[];
}): boolean => {
  if (args.actorUserId === args.reportOwnerUserId) {
    return true;
  }

  if (isAdminLikeUser(args.actorUser)) {
    return true;
  }

  return args.configuredRequesterUserIds.includes(args.actorUserId);
};

const assertReportOpenForSectionApproval = (reportStatus: EventReportStatus) => {
  if (reportStatus === EventReportStatus.PENDING_FINAL) {
    throw new InputValidationError(
      "Section approvals cannot be changed while final approval is pending",
    );
  }

  if (reportStatus === EventReportStatus.APPROVED) {
    throw new InputValidationError(
      "Section approvals cannot be changed after final approval",
    );
  }
};

const assertReportCanSubmitForFinal = (reportStatus: EventReportStatus) => {
  if (reportStatus === EventReportStatus.APPROVED) {
    throw new InputValidationError(
      "Report has already been finally approved",
    );
  }
};

const buildApprovalBlock = (args: {
  status: EventReportSectionApprovalStatus;
  approvedByUserId: number | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  canCurrentUserApprove: boolean;
}): ApprovalBlock => ({
  status: args.status,
  approved_by_user_id: args.approvedByUserId,
  approved_by_name: args.approvedByName,
  approved_at: toIsoStringOrNull(args.approvedAt),
  can_current_user_approve: args.canCurrentUserApprove,
});

const getDepartmentBreakdownTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    eventId: number;
    eventDate: string;
    eventStartTime: string | null;
    eventStartDate: Date | null;
    actorUserId: number;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);
  const reportEventStartTime = buildReportEventStartDateTime(
    args.eventDate,
    args.eventStartTime,
    args.eventStartDate,
  );

  const attendanceRows = await tx.event_attendance.findMany({
    where: {
      event_id: args.eventId,
      created_at: {
        gte: start,
        lt: end,
      },
    },
    orderBy: {
      created_at: "asc",
    },
    select: {
      id: true,
      user_id: true,
      created_at: true,
      user: {
        select: {
          id: true,
          name: true,
          department_id: true,
          department: {
            select: {
              department_id: true,
            },
          },
          department_positions: {
            orderBy: {
              department_id: "asc",
            },
            select: {
              department_id: true,
            },
          },
        },
      },
    },
  });

  const departments = await tx.department.findMany({
    include: {
      department_head_info: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const validDepartmentIdSet = new Set(departments.map((department) => department.id));
  const membersByDepartment = await getDepartmentMembersByDepartmentTx(
    tx,
    validDepartmentIdSet,
  );

  const attendeeByDepartment = new Map<number, Map<number, {
    id: number;
    user_id: number;
    name: string;
    arrival_time: Date;
  }>>();

  for (const row of attendanceRows) {
    const departmentIds = getUserDepartmentIds(row.user, validDepartmentIdSet);

    if (!departmentIds.length) {
      continue;
    }

    for (const departmentId of departmentIds) {
      const bucket = attendeeByDepartment.get(departmentId) || new Map();
      const existingAttendee = bucket.get(row.user_id);

      if (!existingAttendee || row.created_at < existingAttendee.arrival_time) {
        bucket.set(row.user_id, {
          id: row.id,
          user_id: row.user_id,
          name: row.user.name,
          arrival_time: row.created_at,
        });
      }

      attendeeByDepartment.set(departmentId, bucket);
    }
  }

  const departmentBlocks = departments.map((department) => {
    const attendeeMap = attendeeByDepartment.get(department.id) || new Map();
    const memberMap = membersByDepartment.get(department.id) || new Map();
    const absentAttendees: DepartmentAttendanceDetail[] = [];
    const presentAttendees: DepartmentAttendanceDetail[] = [];

    for (const member of memberMap.values()) {
      const attendee = attendeeMap.get(member.user_id);
      const reportedTime = formatReportedTime(attendee?.arrival_time);

      if (!attendee || !reportedTime) {
        absentAttendees.push({
          id: null,
          user_id: member.user_id,
          name: member.name,
          arrival_time: null,
          reported_time: "-",
          relative_to_start: "-",
          status: "absent",
        });
        continue;
      }

      presentAttendees.push({
        id: attendee.id,
        user_id: attendee.user_id,
        name: attendee.name,
        arrival_time: attendee.arrival_time.toISOString(),
        reported_time: reportedTime,
        relative_to_start: formatRelativeToStart(
          attendee.arrival_time,
          reportEventStartTime,
        ),
        status: getReportedAttendanceStatus(
          attendee.arrival_time,
          reportEventStartTime,
        ),
      });
    }

    presentAttendees.sort(
      (left, right) =>
        new Date(left.arrival_time || 0).getTime() -
        new Date(right.arrival_time || 0).getTime(),
    );
    absentAttendees.sort((left, right) => left.name.localeCompare(right.name));

    const totalMembers = memberMap.size;
    const presentMembers = presentAttendees.length;
    const absentMembers = Math.max(totalMembers - presentMembers, 0);
    const attendancePercentage =
      totalMembers > 0
        ? Number(((presentMembers / totalMembers) * 100).toFixed(1))
        : 0;

    return {
      department_id: department.id,
      department_name: department.name,
      head_user_id: department.department_head || null,
      head_name: department.department_head_info?.name || null,
      total_members: totalMembers,
      present_members: presentMembers,
      absent_members: absentMembers,
      attendance_percentage: attendancePercentage,
      attendees: [...presentAttendees, ...absentAttendees],
    };
  }).filter(
    (department) => department.total_members > 0 || department.present_members > 0,
  );

  return {
    departments: departmentBlocks,
    total_members: departmentBlocks.reduce(
      (total, department) => total + department.total_members,
      0,
    ),
    present_members: departmentBlocks.reduce(
      (total, department) => total + department.present_members,
      0,
    ),
  };
};

const getChurchAttendanceBlockTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    eventId: number;
    eventDate: string;
    actorUserId: number;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);

  const attendanceSummary = await tx.event_attendance_summary.findFirst({
    where: {
      event_mgt_id: args.eventId,
      date: {
        gte: start,
        lt: end,
      },
    },
    orderBy: {
      date: "desc",
    },
  });

  const approval = await ensureAttendanceApprovalRowTx(tx, args.eventReportId);
  const approverIds = await getChurchAttendanceApproverUserIdsTx(tx);
  const attendanceReferenceDate = attendanceSummary?.date || new Date(args.eventDate);
  const visitorCountsByKey = await buildAttendanceVisitorCountsMap(
    [
      {
        eventId: args.eventId,
        date: attendanceReferenceDate,
      },
    ],
    tx,
  );
  const visitorCounts = getAttendanceVisitorCountsForRecord(
    visitorCountsByKey,
    args.eventId,
    attendanceReferenceDate,
  );

  return {
    church_attendance: {
      adult_male: Number(attendanceSummary?.adultMale || 0),
      adult_female: Number(attendanceSummary?.adultFemale || 0),
      children_male: Number(attendanceSummary?.childrenMale || 0),
      children_female: Number(attendanceSummary?.childrenFemale || 0),
      youth_male: Number(attendanceSummary?.youthMale || 0),
      youth_female: Number(attendanceSummary?.youthFemale || 0),
      visitors: visitorCounts.total.total,
      visitor_breakdown: {
        visitors: visitorCounts.visitors,
        visitor_clergy: visitorCounts.visitorClergy,
        total: visitorCounts.total,
      },
      visitors_male: visitorCounts.visitors.male,
      visitors_female: visitorCounts.visitors.female,
      visitors_total: visitorCounts.visitors.total,
      visitor_clergy_male: visitorCounts.visitorClergy.male,
      visitor_clergy_female: visitorCounts.visitorClergy.female,
      visitor_clergy_total: visitorCounts.visitorClergy.total,
      visitor_total_male: visitorCounts.total.male,
      visitor_total_female: visitorCounts.total.female,
      visitor_total: visitorCounts.total.total,
      approval: buildApprovalBlock({
        status: approval.status,
        approvedByUserId: approval.approved_by_user_id || null,
        approvedByName: approval.approved_by_user?.name || null,
        approvedAt: approval.approved_at || null,
        canCurrentUserApprove:
          approverIds.includes(args.actorUserId) &&
          approval.status !== EventReportSectionApprovalStatus.APPROVED,
      }),
    },
    isApproved:
      approval.status === EventReportSectionApprovalStatus.APPROVED,
  };
};

const getFinanceBlockTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventReportId: number;
    actorUserId: number;
    requesterId: number;
  },
) => {
  const finance = await ensureFinanceRowTx(tx, args.eventReportId);
  const approval = await ensureFinanceApprovalRowTx(tx, {
    eventReportId: args.eventReportId,
    requesterId: args.requesterId,
  });

  const financeApprovalBlock = buildApprovalBlock({
    status: approval.status || EventReportSectionApprovalStatus.PENDING,
    approvedByUserId: approval.approved_by_user_id || null,
    approvedByName: approval.approved_by_user?.name || null,
    approvedAt: approval.approved_at || null,
    canCurrentUserApprove:
      approval.role_owner_user_id === args.actorUserId &&
      approval.status !== EventReportSectionApprovalStatus.APPROVED,
  });
  const approverName = approval.role_owner_user?.name || null;

  return {
    finance: {
      income: parseStoredFinanceItems(finance.income_json, "income"),
      expense: parseStoredFinanceItems(finance.expense_json, "expense"),
      approver_name: approverName,
      approval: financeApprovalBlock,
      counting_leader_name: approverName,
      finance_rep_name: approverName,
      counting_leader_approval: financeApprovalBlock,
      finance_rep_approval: financeApprovalBlock,
    },
    isApproved:
      financeApprovalBlock.status === EventReportSectionApprovalStatus.APPROVED,
  };
};

const createNotificationEventTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    idempotencyKey: string;
    eventType: EventReportNotificationEventType;
    eventReportId: number;
    actorUserId?: number;
    decision?: "APPROVED" | "REJECTED";
    recipientUserIds: number[];
  },
): Promise<NotificationEventSummary | null> => {
  const recipientUserIds = uniquePositiveIds(args.recipientUserIds);
  const status = recipientUserIds.length
    ? NOTIFICATION_QUEUE_STATUS.PENDING
    : NOTIFICATION_QUEUE_STATUS.SKIPPED_NO_RECIPIENTS;

  try {
    const event = await tx.event_report_notification_events.create({
      data: {
        idempotency_key: args.idempotencyKey,
        event_type: args.eventType,
        event_report_id: args.eventReportId,
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

const buildFinalSubmitIdempotencyKey = (
  eventReportId: number,
  approvalInstanceId: number,
) =>
  `event-report:${eventReportId}:event:${FINAL_SUBMIT_EVENT}:instance:${approvalInstanceId}`;

const buildFinalDecisionIdempotencyKey = (
  eventReportId: number,
  eventType: EventReportNotificationEventType,
  approvalInstanceId: number,
) => `event-report:${eventReportId}:event:${eventType}:instance:${approvalInstanceId}`;

const getPreFinalCompletionStatus = (args: {
  churchAttendanceApproved: boolean;
  financeApproved: boolean;
}) => {
  const allComplete = args.churchAttendanceApproved && args.financeApproved;

  return {
    ...args,
    allComplete,
  };
};

const getEventReportDetailTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate?: string;
    actorUserId: number;
    actorUser: any;
  },
) => {
  const event = await loadEventByIdTx(tx, args.eventId);
  const eventDate = await resolveEventDateForReportTx(tx, {
    eventId: args.eventId,
    eventDate: args.eventDate,
    eventStartDate: event.start_date,
  });

  const report = await ensureEventReportTx(tx, {
    eventId: args.eventId,
    eventDate,
    actorUserId: args.actorUserId,
    reportOwnerUserId: event.created_by,
  });

  const [departmentBlock, churchAttendanceBlock, financeBlock] =
    await Promise.all([
      getDepartmentBreakdownTx(tx, {
        eventReportId: report.id,
        eventId: report.event_id,
        eventDate,
        eventStartTime: event.start_time,
        eventStartDate: event.start_date,
        actorUserId: args.actorUserId,
      }),
      getChurchAttendanceBlockTx(tx, {
        eventReportId: report.id,
        eventId: report.event_id,
        eventDate,
        actorUserId: args.actorUserId,
      }),
      getFinanceBlockTx(tx, {
        eventReportId: report.id,
        actorUserId: args.actorUserId,
        requesterId: report.created_by,
      }),
    ]);

  const completion = getPreFinalCompletionStatus({
    churchAttendanceApproved: churchAttendanceBlock.isApproved,
    financeApproved: financeBlock.isApproved,
  });

  const activeConfig = await getEventReportApprovalConfigOrNullTx(tx);

  const currentPendingFinalStep = await tx.event_report_final_approval_instances.findFirst(
    {
      where: {
        event_report_id: report.id,
        status: FINAL_APPROVAL_STEP_STATUS.PENDING,
      },
      orderBy: {
        step_order: "asc",
      },
      include: {
        approver_user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
  );

  const finalActorUser = report.final_acted_by_user_id
    ? await tx.user.findUnique({
        where: {
          id: report.final_acted_by_user_id,
        },
        select: {
          name: true,
        },
      })
    : null;

  let finalApproverName: string | null = null;
  if (currentPendingFinalStep?.approver_user?.name) {
    finalApproverName = currentPendingFinalStep.approver_user.name;
  } else if (report.final_approver_user_id) {
    const finalApproverUser = await tx.user.findUnique({
      where: {
        id: report.final_approver_user_id,
      },
      select: {
        name: true,
      },
    });
    finalApproverName = finalApproverUser?.name || null;
  }

  const viewersFromConfig = activeConfig?.notifications.map((entry) => entry.user_id) || [];

  const viewerRows = viewersFromConfig.length
    ? await tx.user.findMany({
        where: {
          id: {
            in: viewersFromConfig,
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
        },
      })
    : await tx.event_report_viewers.findMany({
        where: {
          event_report_id: report.id,
        },
        orderBy: {
          user_id: "asc",
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }).then((rows) =>
        rows
          .map((row) => row.user)
          .filter((row): row is { id: number; name: string } => Boolean(row)),
      );

  const configuredRequesterUserIds =
    activeConfig?.requesters.map((entry) => entry.user_id) || [];

  const finalStatus =
    report.status === EventReportStatus.PENDING_FINAL
      ? "PENDING"
      : report.status === EventReportStatus.APPROVED
        ? "APPROVED"
        : report.status === EventReportStatus.REJECTED
          ? "REJECTED"
          : "WAITING";

  const canCurrentUserApproveFinal =
    report.status === EventReportStatus.PENDING_FINAL &&
    currentPendingFinalStep?.approver_user_id === args.actorUserId;

  const canCurrentUserSubmitFinal =
    completion.allComplete &&
    report.status !== EventReportStatus.PENDING_FINAL &&
    report.status !== EventReportStatus.APPROVED &&
    Boolean(activeConfig) &&
    canUserSubmitFinal({
      actorUserId: args.actorUserId,
      actorUser: args.actorUser,
      reportOwnerUserId: report.created_by,
      configuredRequesterUserIds,
    });

  return {
      data: {
        event_id: report.event_id,
        event_name: event.event?.event_name || "Unknown Event",
        event_date: eventDate,
        departments: departmentBlock.departments,
        department_summary: {
          total_members: departmentBlock.total_members,
          present_members: departmentBlock.present_members,
          attendance_percentage:
            departmentBlock.total_members > 0
              ? Number(
                  (
                    (departmentBlock.present_members / departmentBlock.total_members) *
                    100
                  ).toFixed(1),
                )
              : 0,
        },
        church_attendance: churchAttendanceBlock.church_attendance,
        finance: financeBlock.finance,
      final_approval: {
        status: finalStatus,
        approver_user_id:
          currentPendingFinalStep?.approver_user_id || report.final_approver_user_id || null,
        approver_name: finalApproverName,
        acted_by_name: finalActorUser?.name || null,
        acted_at: toIsoStringOrNull(report.final_acted_at),
        can_current_user_submit: canCurrentUserSubmitFinal,
        can_current_user_approve: canCurrentUserApproveFinal,
      },
      final_viewers: viewerRows.map((row) => ({
        id: row.id,
        name: row.name,
      })),
    },
  };
};

export const getEventReportDetail = async (
  query: {
    event_id?: unknown;
    event_date?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(query.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const actorUserId = getAuthenticatedUserId(user);

  const eventDate =
    query.event_date === undefined || query.event_date === null || query.event_date === ""
      ? undefined
      : parseEventDateString(query.event_date);

  const runQuery = async () =>
    runEventReportTransaction(async (tx) =>
      getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      }),
    );

  try {
    return await runQuery();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }
};

export const upsertEventReportFinance = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    income?: unknown;
    expense?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  const incomeItems = normalizeFinanceItems(payload.income, "income");
  const expenseItems = normalizeFinanceItems(payload.expense, "expense");
  const totalIncome = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = expenseItems.reduce((sum, item) => sum + item.amount, 0);
  const surplus = totalIncome - totalExpense;
  const actorUserId = getAuthenticatedUserId(user);

  const runUpsert = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });

      assertReportOpenForSectionApproval(report.status);

      await ensureFinanceRowTx(tx, report.id);
      const financeApproval = await ensureFinanceApprovalRowTx(tx, {
        eventReportId: report.id,
        requesterId: report.created_by,
      });

      const canEditFinance =
        report.created_by === actorUserId ||
        isAdminLikeUser(user) ||
        financeApproval.role_owner_user_id === actorUserId;

      if (!canEditFinance) {
        throw new UnauthorizedError(
          "You are not authorized to edit finance for this report",
        );
      }

      await tx.event_report_finance.update({
        where: {
          event_report_id: report.id,
        },
        data: {
          income_json: JSON.stringify(incomeItems),
          expense_json: JSON.stringify(expenseItems),
          total_income: totalIncome,
          total_expense: totalExpense,
          surplus,
          updated_by_user_id: actorUserId,
        },
      });

      await tx.event_report_finance_approvals.updateMany({
        where: {
          event_report_id: report.id,
        },
        data: {
          status: EventReportSectionApprovalStatus.PENDING,
          approved_by_user_id: null,
          approved_at: null,
        },
      });

      await tx.event_report_final_approval_instances.deleteMany({
        where: {
          event_report_id: report.id,
        },
      });

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          status: EventReportStatus.DRAFT,
          final_approver_user_id: null,
          updated_by: actorUserId,
          final_acted_by_user_id: null,
          final_acted_at: null,
        },
      });

      const financeBlock = await getFinanceBlockTx(tx, {
        eventReportId: report.id,
        actorUserId,
        requesterId: report.created_by,
      });

      return {
        data: financeBlock.finance,
      };
    });

  try {
    return await runUpsert();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }
};

export const departmentApprovalAction = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    department_id?: unknown;
    action?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  const departmentId = toPositiveInt(payload.department_id);
  if (!departmentId) {
    throw new InputValidationError("department_id must be a positive integer");
  }

  parseApprovalAction(payload.action);
  const actorUserId = getAuthenticatedUserId(user);

  const runAction = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const department = await tx.department.findUnique({
        where: {
          id: departmentId,
        },
        select: {
          id: true,
          department_head: true,
        },
      });

      if (!department) {
        throw new NotFoundError("Department not found");
      }

      if (!department.department_head || department.department_head !== actorUserId) {
        throw new UnauthorizedError(
          "Only the department head can approve this department",
        );
      }

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });
      assertReportOpenForSectionApproval(report.status);

      const existing = await tx.event_report_department_approvals.findUnique({
        where: {
          event_report_id_department_id: {
            event_report_id: report.id,
            department_id: departmentId,
          },
        },
      });

      if (existing?.status !== EventReportSectionApprovalStatus.APPROVED) {
        await tx.event_report_department_approvals.upsert({
          where: {
            event_report_id_department_id: {
              event_report_id: report.id,
              department_id: departmentId,
            },
          },
          update: {
            status: EventReportSectionApprovalStatus.APPROVED,
            approved_by_user_id: actorUserId,
            approved_at: new Date(),
          },
          create: {
            event_report_id: report.id,
            department_id: departmentId,
            status: EventReportSectionApprovalStatus.APPROVED,
            approved_by_user_id: actorUserId,
            approved_at: new Date(),
          },
        });
      }

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          updated_by: actorUserId,
        },
      });

      return getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      });
    });

  try {
    return await runAction();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }
};

export const churchAttendanceApprovalAction = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    action?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  parseApprovalAction(payload.action);
  const actorUserId = getAuthenticatedUserId(user);

  const runAction = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const approverIds = await getChurchAttendanceApproverUserIdsTx(tx);
      if (!approverIds.includes(actorUserId)) {
        throw new UnauthorizedError(
          "You are not authorized to approve church attendance",
        );
      }

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });
      assertReportOpenForSectionApproval(report.status);

      const approval = await ensureAttendanceApprovalRowTx(tx, report.id);
      if (approval.status !== EventReportSectionApprovalStatus.APPROVED) {
        await tx.event_report_attendance_approval.update({
          where: {
            event_report_id: report.id,
          },
          data: {
            status: EventReportSectionApprovalStatus.APPROVED,
            approved_by_user_id: actorUserId,
            approved_at: new Date(),
          },
        });
      }

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          updated_by: actorUserId,
        },
      });

      return getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      });
    });

  try {
    return await runAction();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }
};

export const financeApprovalAction = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    role?: unknown;
    action?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  parseApprovalAction(payload.action);
  const actorUserId = getAuthenticatedUserId(user);

  const runAction = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });
      assertReportOpenForSectionApproval(report.status);

      await ensureFinanceRowTx(tx, report.id);
      const approval = await ensureFinanceApprovalRowTx(tx, {
        eventReportId: report.id,
        requesterId: report.created_by,
      });

      if (!approval) {
        throw new NotFoundError("Finance approval record not found");
      }

      if (!approval.role_owner_user_id) {
        throw new InputValidationError(
          "No finance approver has been configured for event reports",
        );
      }

      if (approval.role_owner_user_id !== actorUserId) {
        throw new UnauthorizedError(
          "Only the configured finance approver can approve this finance section",
        );
      }

      if (approval.status !== EventReportSectionApprovalStatus.APPROVED) {
        await tx.event_report_finance_approvals.update({
          where: {
            id: approval.id,
          },
          data: {
            status: EventReportSectionApprovalStatus.APPROVED,
            approved_by_user_id: actorUserId,
            approved_at: new Date(),
          },
        });
      }

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          updated_by: actorUserId,
        },
      });

      return getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      });
    });

  try {
    return await runAction();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }
};

export const submitEventReportForFinalApproval = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  const actorUserId = getAuthenticatedUserId(user);

  const runSubmit = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });
      assertReportCanSubmitForFinal(report.status);

      const departmentBlock = await getDepartmentBreakdownTx(tx, {
        eventReportId: report.id,
        eventId,
        eventDate,
        eventStartTime: event.start_time,
        eventStartDate: event.start_date,
        actorUserId,
      });
      const churchAttendanceBlock = await getChurchAttendanceBlockTx(tx, {
        eventReportId: report.id,
        eventId,
        eventDate,
        actorUserId,
      });
      const financeBlock = await getFinanceBlockTx(tx, {
        eventReportId: report.id,
        actorUserId,
        requesterId: report.created_by,
      });

      const completion = getPreFinalCompletionStatus({
        churchAttendanceApproved: churchAttendanceBlock.isApproved,
        financeApproved: financeBlock.isApproved,
      });

      if (!completion.allComplete) {
        throw new InputValidationError(
          "Cannot submit for final approval until all prerequisite approvals are complete",
        );
      }

      const config = await getActiveEventReportApprovalConfigTx(tx);
      const configuredRequesterUserIds = config.requesters.map(
        (requester) => requester.user_id,
      );

      if (
        !canUserSubmitFinal({
          actorUserId,
          actorUser: user,
          reportOwnerUserId: report.created_by,
          configuredRequesterUserIds,
        })
      ) {
        throw new UnauthorizedError(
          "You are not authorized to submit this report for final approval",
        );
      }

      const existingPending = await tx.event_report_final_approval_instances.findFirst({
        where: {
          event_report_id: report.id,
          status: FINAL_APPROVAL_STEP_STATUS.PENDING,
        },
        orderBy: {
          step_order: "asc",
        },
      });

      if (existingPending && report.status === EventReportStatus.PENDING_FINAL) {
        return getEventReportDetailTx(tx, {
          eventId,
          eventDate,
          actorUserId,
          actorUser: user,
        });
      }

      await tx.event_report_final_approval_instances.deleteMany({
        where: {
          event_report_id: report.id,
        },
      });

      const snapshotRows: Array<{
        event_report_id: number;
        config_id: number;
        step_order: number;
        step_type: EventReportApproverType;
        approver_user_id: number;
        position_id: number | null;
        configured_user_id: number | null;
        status: EventReportFinalApprovalStepStatus;
      }> = [];

      for (let index = 0; index < config.steps.length; index += 1) {
        const step = config.steps[index];
        const approverUserId = await resolveApproverUserIdForStep(tx, {
          step,
          requesterId: actorUserId,
        });

        snapshotRows.push({
          event_report_id: report.id,
          config_id: config.id,
          step_order: step.step_order,
          step_type: step.step_type,
          approver_user_id: approverUserId,
          position_id: step.position_id,
          configured_user_id: step.user_id,
          status:
            index === 0
              ? FINAL_APPROVAL_STEP_STATUS.PENDING
              : FINAL_APPROVAL_STEP_STATUS.WAITING,
        });
      }

      await tx.event_report_final_approval_instances.createMany({
        data: snapshotRows,
      });

      const firstPendingStep = await tx.event_report_final_approval_instances.findFirst({
        where: {
          event_report_id: report.id,
          status: FINAL_APPROVAL_STEP_STATUS.PENDING,
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

      if (!firstPendingStep) {
        throw new InputValidationError(
          "Active EVENT_REPORT approval config has no approver steps",
        );
      }

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          status: EventReportStatus.PENDING_FINAL,
          final_approver_user_id: firstPendingStep.approver_user_id,
          final_acted_by_user_id: null,
          final_acted_at: null,
          updated_by: actorUserId,
        },
      });

      await syncEventReportViewersTx(tx, {
        eventReportId: report.id,
        userIds: config.notifications.map((notification) => notification.user_id),
      });

      const recipientUserIds = await resolveActiveRecipientUserIdsTx(
        tx,
        [firstPendingStep.approver_user_id],
        actorUserId,
      );

      await createNotificationEventTx(tx, {
        idempotencyKey: buildFinalSubmitIdempotencyKey(
          report.id,
          firstPendingStep.id,
        ),
        eventType: FINAL_SUBMIT_EVENT,
        eventReportId: report.id,
        actorUserId,
        recipientUserIds,
      });

      return getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      });
    });

  let result;
  try {
    result = await runSubmit();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }

  triggerEventReportNotificationEventProcessing();
  return result;
};

export const finalApprovalAction = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    action?: unknown;
    comment?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  const action = parseFinalApprovalAction(payload.action);
  const comment = parseOptionalComment(payload.comment);
  const actorUserId = getAuthenticatedUserId(user);

  const runAction = async () =>
    runEventReportTransaction(async (tx) => {
      const event = await loadEventByIdTx(tx, eventId);

      const report = await ensureEventReportTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        reportOwnerUserId: event.created_by,
      });

      if (report.status !== EventReportStatus.PENDING_FINAL) {
        throw new InputValidationError(
          "Report is not pending final approval",
        );
      }

      const currentPendingStep =
        await tx.event_report_final_approval_instances.findFirst({
          where: {
            event_report_id: report.id,
            status: FINAL_APPROVAL_STEP_STATUS.PENDING,
          },
          orderBy: {
            step_order: "asc",
          },
        });

      if (!currentPendingStep) {
        throw new InputValidationError(
          "No pending final approval step found for this report",
        );
      }

      if (currentPendingStep.approver_user_id !== actorUserId) {
        throw new UnauthorizedError(
          "You are not the assigned final approver for the current step",
        );
      }

      const actionData = {
        acted_by_user_id: actorUserId,
        acted_at: new Date(),
        ...(comment !== undefined ? { comment } : {}),
      };

      if (action === "REJECT") {
        await tx.event_report_final_approval_instances.update({
          where: {
            id: currentPendingStep.id,
          },
          data: {
            status: FINAL_APPROVAL_STEP_STATUS.REJECTED,
            ...actionData,
          },
        });

        await tx.event_reports.update({
          where: {
            id: report.id,
          },
          data: {
            status: EventReportStatus.REJECTED,
            final_approver_user_id: currentPendingStep.approver_user_id,
            final_acted_by_user_id: actorUserId,
            final_acted_at: new Date(),
            updated_by: actorUserId,
          },
        });

        const viewerRows = await tx.event_report_viewers.findMany({
          where: {
            event_report_id: report.id,
          },
          select: {
            user_id: true,
          },
        });

        const recipientUserIds = await resolveActiveRecipientUserIdsTx(
          tx,
          [report.created_by, ...viewerRows.map((viewer) => viewer.user_id)],
          actorUserId,
        );

        await createNotificationEventTx(tx, {
          idempotencyKey: buildFinalDecisionIdempotencyKey(
            report.id,
            FINAL_REJECTED_EVENT,
            currentPendingStep.id,
          ),
          eventType: FINAL_REJECTED_EVENT,
          eventReportId: report.id,
          actorUserId,
          decision: "REJECTED",
          recipientUserIds,
        });

        return getEventReportDetailTx(tx, {
          eventId,
          eventDate,
          actorUserId,
          actorUser: user,
        });
      }

      await tx.event_report_final_approval_instances.update({
        where: {
          id: currentPendingStep.id,
        },
        data: {
          status: FINAL_APPROVAL_STEP_STATUS.APPROVED,
          ...actionData,
        },
      });

      const nextStep = await tx.event_report_final_approval_instances.findFirst({
        where: {
          event_report_id: report.id,
          status: FINAL_APPROVAL_STEP_STATUS.WAITING,
          step_order: {
            gt: currentPendingStep.step_order,
          },
        },
        orderBy: {
          step_order: "asc",
        },
      });

      if (nextStep) {
        await tx.event_report_final_approval_instances.update({
          where: {
            id: nextStep.id,
          },
          data: {
            status: FINAL_APPROVAL_STEP_STATUS.PENDING,
          },
        });

        await tx.event_reports.update({
          where: {
            id: report.id,
          },
          data: {
            status: EventReportStatus.PENDING_FINAL,
            final_approver_user_id: nextStep.approver_user_id,
            updated_by: actorUserId,
          },
        });

        const nextApproverRecipientUserIds = await resolveActiveRecipientUserIdsTx(
          tx,
          [nextStep.approver_user_id],
          actorUserId,
        );

        await createNotificationEventTx(tx, {
          idempotencyKey: buildFinalSubmitIdempotencyKey(
            report.id,
            nextStep.id,
          ),
          eventType: FINAL_SUBMIT_EVENT,
          eventReportId: report.id,
          actorUserId,
          recipientUserIds: nextApproverRecipientUserIds,
        });

        return getEventReportDetailTx(tx, {
          eventId,
          eventDate,
          actorUserId,
          actorUser: user,
        });
      }

      await tx.event_reports.update({
        where: {
          id: report.id,
        },
        data: {
          status: EventReportStatus.APPROVED,
          final_approver_user_id: currentPendingStep.approver_user_id,
          final_acted_by_user_id: actorUserId,
          final_acted_at: new Date(),
          updated_by: actorUserId,
        },
      });

      const viewerRows = await tx.event_report_viewers.findMany({
        where: {
          event_report_id: report.id,
        },
        select: {
          user_id: true,
        },
      });

      const recipientUserIds = await resolveActiveRecipientUserIdsTx(
        tx,
        [report.created_by, ...viewerRows.map((viewer) => viewer.user_id)],
        actorUserId,
      );

      await createNotificationEventTx(tx, {
        idempotencyKey: buildFinalDecisionIdempotencyKey(
          report.id,
          FINAL_APPROVED_EVENT,
          currentPendingStep.id,
        ),
        eventType: FINAL_APPROVED_EVENT,
        eventReportId: report.id,
        actorUserId,
        decision: "APPROVED",
        recipientUserIds,
      });

      return getEventReportDetailTx(tx, {
        eventId,
        eventDate,
        actorUserId,
        actorUser: user,
      });
    });

  let result;
  try {
    result = await runAction();
  } catch (error) {
    if (!isEventReportTableMissingError(error)) {
      throw error;
    }

    throw new InputValidationError(
      "Event report tables are missing. Run database migrations first.",
    );
  }

  triggerEventReportNotificationEventProcessing();
  return result;
};

const parseRecipientUserIdsSnapshot = (value: string): number[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return uniquePositiveIds(
      parsed
        .map((entry) => toPositiveInt(entry))
        .filter((entry): entry is number => Number.isInteger(entry)),
    );
  } catch (error) {
    return [];
  }
};

const isSupportedNotificationEventType = (
  value: string,
): value is EventReportNotificationEventType =>
  value === FINAL_SUBMIT_EVENT ||
  value === FINAL_APPROVED_EVENT ||
  value === FINAL_REJECTED_EVENT;

let isProcessingNotificationEvents = false;
let hasLoggedMissingNotificationDelegates = false;

const resolveNotificationProcessingDelegates = () => {
  const notificationEventsDelegate = (
    prisma as unknown as {
      event_report_notification_events?: {
        findMany: typeof prisma.event_report_notification_events.findMany;
        updateMany: typeof prisma.event_report_notification_events.updateMany;
        update: typeof prisma.event_report_notification_events.update;
      };
    }
  ).event_report_notification_events;

  const eventReportsDelegate = (
    prisma as unknown as {
      event_reports?: {
        findUnique: typeof prisma.event_reports.findUnique;
      };
    }
  ).event_reports;

  if (
    !notificationEventsDelegate ||
    typeof notificationEventsDelegate.findMany !== "function" ||
    typeof notificationEventsDelegate.updateMany !== "function" ||
    typeof notificationEventsDelegate.update !== "function" ||
    !eventReportsDelegate ||
    typeof eventReportsDelegate.findUnique !== "function"
  ) {
    if (!hasLoggedMissingNotificationDelegates) {
      hasLoggedMissingNotificationDelegates = true;
      console.error(
        "[event-report-notification-events] Prisma client is missing event-report delegates. Run `npx prisma generate` and restart the server.",
      );
    }

    return null;
  }

  hasLoggedMissingNotificationDelegates = false;
  return {
    notificationEventsDelegate,
    eventReportsDelegate,
  };
};

export const processPendingEventReportNotificationEvents = async (args?: {
  limit?: number;
}): Promise<void> => {
  if (isProcessingNotificationEvents) {
    return;
  }

  isProcessingNotificationEvents = true;

  try {
    const delegates = resolveNotificationProcessingDelegates();
    if (!delegates) {
      return;
    }

    const { notificationEventsDelegate, eventReportsDelegate } = delegates;

    const limit =
      Number.isInteger(args?.limit) && (args?.limit || 0) > 0
        ? Math.min(args?.limit || 0, 100)
        : NOTIFICATION_EVENT_BATCH_SIZE;

    const events = await notificationEventsDelegate.findMany({
      where: {
        status: {
          in: [
            NOTIFICATION_QUEUE_STATUS.PENDING,
            NOTIFICATION_QUEUE_STATUS.FAILED,
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
        event_report_id: true,
        actor_user_id: true,
        recipient_user_ids: true,
      },
    });

    for (const event of events) {
      const claim = await notificationEventsDelegate.updateMany({
        where: {
          id: event.id,
          status: {
            in: [
              NOTIFICATION_QUEUE_STATUS.PENDING,
              NOTIFICATION_QUEUE_STATUS.FAILED,
            ],
          },
        },
        data: {
          status: NOTIFICATION_QUEUE_STATUS.PROCESSING,
        },
      });

      if (!claim.count) {
        continue;
      }

      try {
        if (!isSupportedNotificationEventType(event.event_type)) {
          throw new Error(`Unsupported notification event type: ${event.event_type}`);
        }

        const recipientUserIds = parseRecipientUserIdsSnapshot(
          event.recipient_user_ids,
        );

        if (!recipientUserIds.length) {
          await notificationEventsDelegate.update({
            where: {
              id: event.id,
            },
            data: {
              status: NOTIFICATION_QUEUE_STATUS.SKIPPED_NO_RECIPIENTS,
              attempts: {
                increment: 1,
              },
              last_error: null,
            },
          });

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

        const [report, actorUser, recipientUsers] = await Promise.all([
          eventReportsDelegate.findUnique({
            where: {
              id: event.event_report_id,
            },
            select: {
              id: true,
              event_id: true,
              event_date: true,
              created_by: true,
              event: {
                select: {
                  event: {
                    select: {
                      event_name: true,
                    },
                  },
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
            },
          }),
        ]);

        if (!report) {
          throw new NotFoundError("Event report not found for notification event");
        }

        if (!recipientUsers.length) {
          await notificationEventsDelegate.update({
            where: {
              id: event.id,
            },
            data: {
              status: NOTIFICATION_QUEUE_STATUS.SKIPPED_NO_RECIPIENTS,
              attempts: {
                increment: 1,
              },
              last_error: null,
            },
          });

          continue;
        }

        const eventDate = toYmdDateString(report.event_date);
        const actionUrl = buildEventReportActionUrl(report.event_id, eventDate);
        const actorName = actorUser?.name || "System";
        const eventName = report.event?.event?.event_name || "Event";

        const title =
          event.event_type === FINAL_SUBMIT_EVENT
            ? "Event report pending final approval"
            : event.event_type === FINAL_APPROVED_EVENT
              ? "Event report approved"
              : "Event report rejected";

        const body =
          event.event_type === FINAL_SUBMIT_EVENT
            ? `${actorName} submitted ${eventName} (${eventDate}) for final approval.`
            : event.event_type === FINAL_APPROVED_EVENT
              ? `${eventName} (${eventDate}) has been finally approved by ${actorName}.`
              : `${eventName} (${eventDate}) has been finally rejected by ${actorName}.`;

        const priority =
          event.event_type === FINAL_SUBMIT_EVENT ? "HIGH" : "HIGH";

        await notificationService.createManyInAppNotifications(
          recipientUsers.map((recipient) => ({
            type: event.event_type,
            title,
            body,
            recipientUserId: recipient.id,
            actorUserId: event.actor_user_id || null,
            entityType: "event_report",
            entityId: String(report.id),
            actionUrl,
            priority,
            dedupeKey: `event-report:event:${event.id}:recipient:${recipient.id}`,
            sendSms: true,
            smsBody: body,
          })),
        );

        await notificationEventsDelegate.update({
          where: {
            id: event.id,
          },
          data: {
            status: NOTIFICATION_QUEUE_STATUS.SENT,
            sent_at: new Date(),
            attempts: {
              increment: 1,
            },
            last_error: null,
          },
        });
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error.message : String(error);

        await notificationEventsDelegate.update({
          where: {
            id: event.id,
          },
          data: {
            status: NOTIFICATION_QUEUE_STATUS.FAILED,
            attempts: {
              increment: 1,
            },
            last_error: normalizedError.slice(0, 4000),
          },
        });
      }
    }
  } catch (error) {
    if (isEventReportTableMissingError(error)) {
      return;
    }

    throw error;
  } finally {
    isProcessingNotificationEvents = false;
  }
};

export const triggerEventReportNotificationEventProcessing = () => {
  void processPendingEventReportNotificationEvents().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[event-report-notification-events] background processing failed: ${message}`,
    );

    void notificationService.notifyAdminsJobFailed({
      jobName: "event-report-notification-events-trigger",
      errorMessage: message,
      actionUrl: "/home/notifications",
      dedupeKey: `job:event-report-notification-trigger:${new Date()
        .toISOString()
        .slice(0, 13)}`,
    });
  });
};
