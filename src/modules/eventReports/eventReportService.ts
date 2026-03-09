import {
  EventReportFinanceRole,
  EventReportSectionApprovalStatus,
  EventReportStatus,
  Prisma,
  RequisitionApprovalInstanceStatus,
  RequisitionApprovalModule,
  RequisitionApproverType,
  RequisitionNotificationEventStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { RequisitionApprovalConfigPayload } from "../../interfaces/requisitions-interface";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { notificationService } from "../notifications/notificationService";
import {
  getApprovalConfigByModule,
  upsertRequisitionApprovalConfig,
} from "../requisitions/requisition-approval-workflow";

type EventReportNotificationEventType =
  | "event_report.submitted_for_final_approval"
  | "event_report.final_approved"
  | "event_report.final_rejected";

type EventReportAction = "APPROVE" | "REJECT";

type ApprovalWorkflowTx = Prisma.TransactionClient;

type FinanceItem = {
  id: string;
  name: string;
  amount: number;
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

const EVENT_REPORT_MODULE =
  ((RequisitionApprovalModule as Record<string, string> | undefined)
    ?.EVENT_REPORT || "EVENT_REPORT") as RequisitionApprovalModule;
const MANAGE_PERMISSION_VALUES = ["Can_Manage", "Super_Admin"];
const NOTIFICATION_EVENT_RETRY_LIMIT = 5;
const NOTIFICATION_EVENT_BATCH_SIZE = 5;
const FINAL_SUBMIT_EVENT: EventReportNotificationEventType =
  "event_report.submitted_for_final_approval";
const FINAL_APPROVED_EVENT: EventReportNotificationEventType =
  "event_report.final_approved";
const FINAL_REJECTED_EVENT: EventReportNotificationEventType =
  "event_report.final_rejected";

const EVENT_REPORT_TABLE_NAMES = [
  "event_reports",
  "event_report_department_approvals",
  "event_report_attendance_approval",
  "event_report_finance",
  "event_report_finance_approvals",
  "event_report_viewers",
  "event_report_final_approval_instances",
  "event_report_notification_events",
];

type EventReportApprovalConfigPayload = Omit<
  RequisitionApprovalConfigPayload,
  "module" | "requester_user_ids"
> & {
  requester_user_ids?: number[];
  module?: unknown;
};

export const saveEventReportApprovalConfig = async (
  payload: EventReportApprovalConfigPayload,
  actorUserId?: number,
) => {
  const requestedModule = payload?.module;
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

  return upsertRequisitionApprovalConfig(
    {
      ...payload,
      module: EVENT_REPORT_MODULE,
      requester_user_ids: [],
    },
    actorUserId,
  );
};

export const fetchEventReportApprovalConfig = async () => {
  const config = await getApprovalConfigByModule(EVENT_REPORT_MODULE);
  if (!config) {
    return null;
  }

  return {
    ...config,
    requester_user_ids: [],
  };
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

const parseFinanceRole = (value: unknown): EventReportFinanceRole => {
  if (value !== EventReportFinanceRole.COUNTING_LEADER && value !== EventReportFinanceRole.FINANCE_REP) {
    throw new InputValidationError("role must be COUNTING_LEADER or FINANCE_REP");
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

const getFinanceRoleOwnerFromEnv = (
  role: EventReportFinanceRole,
): number | null => {
  const envName =
    role === EventReportFinanceRole.COUNTING_LEADER
      ? "EVENT_REPORT_COUNTING_LEADER_USER_ID"
      : "EVENT_REPORT_FINANCE_REP_USER_ID";

  return toPositiveInt(process.env[envName]);
};

const getFinanceRoleOwnerFromPositionTx = async (
  tx: ApprovalWorkflowTx,
  role: EventReportFinanceRole,
): Promise<number | null> => {
  const candidateUsers = await tx.user.findMany({
    where: {
      NOT: {
        is_active: false,
      },
      position: {
        isNot: null,
      },
    },
    orderBy: {
      id: "asc",
    },
    select: {
      id: true,
      position: {
        select: {
          name: true,
        },
      },
    },
  });

  const acceptedPositionPatterns =
    role === EventReportFinanceRole.COUNTING_LEADER
      ? [/counting\s*leader/i]
      : [/finance\s*rep/i, /finance\s*representative/i];

  const matched = candidateUsers
    .filter((user) => {
      const positionName = user.position?.name || "";
      return acceptedPositionPatterns.some((pattern) => pattern.test(positionName));
    })
    .map((user) => user.id);

  if (!matched.length) {
    return null;
  }

  return matched[0];
};

const getFinanceRoleOwnerFromPermissionTx = async (
  tx: ApprovalWorkflowTx,
): Promise<number | null> => {
  const users = await tx.user.findMany({
    where: {
      NOT: {
        is_active: false,
      },
    },
    orderBy: {
      id: "asc",
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

  const matched = users.find((user) =>
    hasPermissionValue(user.access?.permissions, [
      "Financials",
      "Settings",
      "Requisition",
      "Requisitions",
    ]),
  );

  return matched?.id || null;
};

const resolveFinanceRoleOwnerUserIdTx = async (
  tx: ApprovalWorkflowTx,
  role: EventReportFinanceRole,
): Promise<number | null> => {
  const fromEnv = getFinanceRoleOwnerFromEnv(role);
  if (fromEnv) {
    const user = await tx.user.findUnique({
      where: {
        id: fromEnv,
      },
      select: {
        id: true,
        is_active: true,
      },
    });

    if (user && user.is_active !== false) {
      return user.id;
    }
  }

  const fromPosition = await getFinanceRoleOwnerFromPositionTx(tx, role);
  if (fromPosition) {
    return fromPosition;
  }

  return getFinanceRoleOwnerFromPermissionTx(tx);
};

const ensureFinanceApprovalRowsTx = async (
  tx: ApprovalWorkflowTx,
  eventReportId: number,
) => {
  const roles = [
    EventReportFinanceRole.COUNTING_LEADER,
    EventReportFinanceRole.FINANCE_REP,
  ];

  for (const role of roles) {
    const row = await tx.event_report_finance_approvals.findUnique({
      where: {
        event_report_id_role: {
          event_report_id: eventReportId,
          role,
        },
      },
      select: {
        id: true,
        role_owner_user_id: true,
      },
    });

    const roleOwnerUserId =
      row?.role_owner_user_id ||
      (await resolveFinanceRoleOwnerUserIdTx(tx, role));

    if (!row) {
      await tx.event_report_finance_approvals.create({
        data: {
          event_report_id: eventReportId,
          role,
          role_owner_user_id: roleOwnerUserId,
          status: EventReportSectionApprovalStatus.PENDING,
        },
      });
      continue;
    }

    if (!row.role_owner_user_id && roleOwnerUserId) {
      await tx.event_report_finance_approvals.update({
        where: {
          id: row.id,
        },
        data: {
          role_owner_user_id: roleOwnerUserId,
        },
      });
    }
  }

  return tx.event_report_finance_approvals.findMany({
    where: {
      event_report_id: eventReportId,
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

  const existingRows = await tx.event_report_department_approvals.findMany({
    where: {
      event_report_id: args.eventReportId,
      department_id: {
        in: uniqueDepartmentIds,
      },
    },
    select: {
      department_id: true,
    },
  });

  const existingDepartmentIdSet = new Set(
    existingRows.map((row) => row.department_id),
  );

  const missingDepartmentIds = uniqueDepartmentIds.filter(
    (departmentId) => !existingDepartmentIdSet.has(departmentId),
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
  const config = await tx.requisition_approval_configs.findUnique({
    where: {
      module: EVENT_REPORT_MODULE,
    },
    include: {
      requesters: {
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
  const config = await tx.requisition_approval_configs.findUnique({
    where: {
      module: EVENT_REPORT_MODULE,
    },
    include: {
      requesters: {
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
      step_type: RequisitionApproverType;
      position_id: number | null;
      user_id: number | null;
    };
    requesterId: number;
  },
): Promise<number> => {
  const { step, requesterId } = args;

  if (step.step_type === RequisitionApproverType.HEAD_OF_DEPARTMENT) {
    return resolveHeadOfDepartmentApproverUserId(tx, requesterId);
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

const isAdminLikeUser = (user: any): boolean => {
  const permissions = user?.permissions as Prisma.JsonValue | null | undefined;

  if (isSuperAdmin(permissions)) {
    return true;
  }

  return hasPermissionValue(permissions, [
    "Requisition",
    "Requisitions",
    "Settings",
    "Events",
    "Financials",
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
    actorUserId: number;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);

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

  const attendeeByDepartment = new Map<number, Array<{
    id: number;
    user_id: number;
    name: string;
    arrival_time: string;
  }>>();

  for (const row of attendanceRows) {
    const primaryDepartmentId =
      row.user.department?.department_id ||
      row.user.department_id ||
      row.user.department_positions[0]?.department_id ||
      null;

    if (!primaryDepartmentId) {
      continue;
    }

    const bucket = attendeeByDepartment.get(primaryDepartmentId) || [];
    bucket.push({
      id: row.id,
      user_id: row.user_id,
      name: row.user.name,
      arrival_time: row.created_at.toISOString(),
    });
    attendeeByDepartment.set(primaryDepartmentId, bucket);
  }

  const departmentIds = Array.from(attendeeByDepartment.keys());
  await ensureDepartmentApprovalRowsTx(tx, {
    eventReportId: args.eventReportId,
    departmentIds,
  });

  const approvals = await tx.event_report_department_approvals.findMany({
    where: {
      event_report_id: args.eventReportId,
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

  const allDepartmentIds = uniquePositiveIds([
    ...departmentIds,
    ...approvals.map((approval) => approval.department_id),
  ]);

  if (!allDepartmentIds.length) {
    return {
      departments: [] as any[],
      allApproved: true,
    };
  }

  const departments = await tx.department.findMany({
    where: {
      id: {
        in: allDepartmentIds,
      },
    },
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

  const approvalByDepartmentId = new Map(
    approvals.map((approval) => [approval.department_id, approval]),
  );

  const departmentBlocks = departments.map((department) => {
    const approval = approvalByDepartmentId.get(department.id);
    const status =
      approval?.status || EventReportSectionApprovalStatus.PENDING;

    return {
      department_id: department.id,
      department_name: department.name,
      head_user_id: department.department_head || null,
      head_name: department.department_head_info?.name || null,
      attendees: attendeeByDepartment.get(department.id) || [],
      approval: buildApprovalBlock({
        status,
        approvedByUserId: approval?.approved_by_user_id || null,
        approvedByName: approval?.approved_by_user?.name || null,
        approvedAt: approval?.approved_at || null,
        canCurrentUserApprove:
          department.department_head === args.actorUserId &&
          status !== EventReportSectionApprovalStatus.APPROVED,
      }),
    };
  });

  const allApproved = departmentBlocks.every(
    (department) =>
      department.approval.status === EventReportSectionApprovalStatus.APPROVED,
  );

  return {
    departments: departmentBlocks,
    allApproved,
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

  return {
    church_attendance: {
      adult_male: Number(attendanceSummary?.adultMale || 0),
      adult_female: Number(attendanceSummary?.adultFemale || 0),
      children_male: Number(attendanceSummary?.childrenMale || 0),
      children_female: Number(attendanceSummary?.childrenFemale || 0),
      youth_male: Number(attendanceSummary?.youthMale || 0),
      youth_female: Number(attendanceSummary?.youthFemale || 0),
      visiting_pastors: Number(attendanceSummary?.visitingPastors || 0),
      visitors: Number(attendanceSummary?.visitors || 0),
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
  },
) => {
  const finance = await ensureFinanceRowTx(tx, args.eventReportId);
  const approvals = await ensureFinanceApprovalRowsTx(tx, args.eventReportId);

  const countingLeaderApproval = approvals.find(
    (approval) => approval.role === EventReportFinanceRole.COUNTING_LEADER,
  );
  const financeRepApproval = approvals.find(
    (approval) => approval.role === EventReportFinanceRole.FINANCE_REP,
  );

  const countingLeaderBlock = buildApprovalBlock({
    status:
      countingLeaderApproval?.status || EventReportSectionApprovalStatus.PENDING,
    approvedByUserId: countingLeaderApproval?.approved_by_user_id || null,
    approvedByName: countingLeaderApproval?.approved_by_user?.name || null,
    approvedAt: countingLeaderApproval?.approved_at || null,
    canCurrentUserApprove:
      countingLeaderApproval?.role_owner_user_id === args.actorUserId &&
      countingLeaderApproval.status !== EventReportSectionApprovalStatus.APPROVED,
  });

  const financeRepBlock = buildApprovalBlock({
    status:
      financeRepApproval?.status || EventReportSectionApprovalStatus.PENDING,
    approvedByUserId: financeRepApproval?.approved_by_user_id || null,
    approvedByName: financeRepApproval?.approved_by_user?.name || null,
    approvedAt: financeRepApproval?.approved_at || null,
    canCurrentUserApprove:
      financeRepApproval?.role_owner_user_id === args.actorUserId &&
      financeRepApproval.status !== EventReportSectionApprovalStatus.APPROVED,
  });

  return {
    finance: {
      income: parseStoredFinanceItems(finance.income_json, "income"),
      expense: parseStoredFinanceItems(finance.expense_json, "expense"),
      counting_leader_name: countingLeaderApproval?.role_owner_user?.name || null,
      finance_rep_name: financeRepApproval?.role_owner_user?.name || null,
      counting_leader_approval: countingLeaderBlock,
      finance_rep_approval: financeRepBlock,
    },
    countingLeaderApproved:
      countingLeaderBlock.status === EventReportSectionApprovalStatus.APPROVED,
    financeRepApproved:
      financeRepBlock.status === EventReportSectionApprovalStatus.APPROVED,
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
    ? RequisitionNotificationEventStatus.PENDING
    : RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS;

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
  allDepartmentsApproved: boolean;
  churchAttendanceApproved: boolean;
  countingLeaderApproved: boolean;
  financeRepApproved: boolean;
}) => {
  const allComplete =
    args.allDepartmentsApproved &&
    args.churchAttendanceApproved &&
    args.countingLeaderApproved &&
    args.financeRepApproved;

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
      }),
    ]);

  const completion = getPreFinalCompletionStatus({
    allDepartmentsApproved: departmentBlock.allApproved,
    churchAttendanceApproved: churchAttendanceBlock.isApproved,
    countingLeaderApproved: financeBlock.countingLeaderApproved,
    financeRepApproved: financeBlock.financeRepApproved,
  });

  const activeConfig = await getEventReportApprovalConfigOrNullTx(tx);

  const currentPendingFinalStep = await tx.event_report_final_approval_instances.findFirst(
    {
      where: {
        event_report_id: report.id,
        status: RequisitionApprovalInstanceStatus.PENDING,
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
      const financeApprovals = await ensureFinanceApprovalRowsTx(tx, report.id);

      const canEditFinance =
        report.created_by === actorUserId ||
        isAdminLikeUser(user) ||
        financeApprovals.some(
          (approval) => approval.role_owner_user_id === actorUserId,
        );

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
  const role = parseFinanceRole(payload.role);
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
      await ensureFinanceApprovalRowsTx(tx, report.id);

      const approval = await tx.event_report_finance_approvals.findUnique({
        where: {
          event_report_id_role: {
            event_report_id: report.id,
            role,
          },
        },
      });

      if (!approval) {
        throw new NotFoundError("Finance approval role not found");
      }

      const roleOwnerUserId =
        approval.role_owner_user_id || (await resolveFinanceRoleOwnerUserIdTx(tx, role));

      if (!roleOwnerUserId || roleOwnerUserId !== actorUserId) {
        throw new UnauthorizedError(
          "Only the mapped role owner can approve this finance step",
        );
      }

      if (approval.status !== EventReportSectionApprovalStatus.APPROVED) {
        await tx.event_report_finance_approvals.update({
          where: {
            id: approval.id,
          },
          data: {
            role_owner_user_id: roleOwnerUserId,
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
      });

      const completion = getPreFinalCompletionStatus({
        allDepartmentsApproved: departmentBlock.allApproved,
        churchAttendanceApproved: churchAttendanceBlock.isApproved,
        countingLeaderApproved: financeBlock.countingLeaderApproved,
        financeRepApproved: financeBlock.financeRepApproved,
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
          status: RequisitionApprovalInstanceStatus.PENDING,
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
        step_type: RequisitionApproverType;
        approver_user_id: number;
        position_id: number | null;
        configured_user_id: number | null;
        status: RequisitionApprovalInstanceStatus;
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
              ? RequisitionApprovalInstanceStatus.PENDING
              : RequisitionApprovalInstanceStatus.WAITING,
        });
      }

      await tx.event_report_final_approval_instances.createMany({
        data: snapshotRows,
      });

      const firstPendingStep = await tx.event_report_final_approval_instances.findFirst({
        where: {
          event_report_id: report.id,
          status: RequisitionApprovalInstanceStatus.PENDING,
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
            status: RequisitionApprovalInstanceStatus.PENDING,
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
            status: RequisitionApprovalInstanceStatus.REJECTED,
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
          status: RequisitionApprovalInstanceStatus.APPROVED,
          ...actionData,
        },
      });

      const nextStep = await tx.event_report_final_approval_instances.findFirst({
        where: {
          event_report_id: report.id,
          status: RequisitionApprovalInstanceStatus.WAITING,
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
            status: RequisitionApprovalInstanceStatus.PENDING,
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
              status: RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS,
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
              status: RequisitionNotificationEventStatus.SKIPPED_NO_RECIPIENTS,
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
            sendEmail: false,
          })),
        );

        await notificationEventsDelegate.update({
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
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error.message : String(error);

        await notificationEventsDelegate.update({
          where: {
            id: event.id,
          },
          data: {
            status: RequisitionNotificationEventStatus.FAILED,
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
