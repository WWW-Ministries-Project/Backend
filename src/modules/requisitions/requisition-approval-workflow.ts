import {
  Prisma,
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  RequisitionApprovalModule,
  RequisitionApproverType,
} from "@prisma/client";
import {
  RequisitionApprovalActionPayload,
  RequisitionApprovalConfigPayload,
} from "../../interfaces/requisitions-interface";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";

type RequisitionApprovalConfigResponse = {
  module: RequisitionApprovalModule;
  requester_user_ids: number[];
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
  approvers: NormalizedApproverStep[];
  isActive: boolean;
};

type ApprovalAction = RequisitionApprovalActionPayload["action"];

type ApprovalWorkflowTx = Prisma.TransactionClient;

const REQUISITION_MODULE = RequisitionApprovalModule.REQUISITION;
const REQUISITION_PERMISSION_KEYS = ["Requisition", "Requisitions"];
const REQUISITION_MANAGE_PERMISSION_VALUES = ["Can_Manage", "Super_Admin"];

const REQUISITION_APPROVAL_TABLE_NAMES = [
  "requisition_approval_configs",
  "requisition_approval_config_requesters",
  "requisition_approval_config_steps",
  "requisition_approval_instances",
];

let ensureWorkflowTablesPromise: Promise<void> | null = null;

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
  if (ensureWorkflowTablesPromise) {
    return ensureWorkflowTablesPromise;
  }

  ensureWorkflowTablesPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`requisition_approval_configs\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`module\` ENUM('REQUISITION') NOT NULL,
        \`is_active\` BOOLEAN NOT NULL DEFAULT true,
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

    // Best-effort FK wiring for environments where migrations were skipped.
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
  })();

  try {
    await ensureWorkflowTablesPromise;
  } finally {
    ensureWorkflowTablesPromise = null;
  }
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
  if (value !== REQUISITION_MODULE) {
    throw new InputValidationError("module must be REQUISITION");
  }

  return REQUISITION_MODULE;
};

const parseRequesterUserIds = (value: unknown): number[] => {
  if (!Array.isArray(value) || !value.length) {
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

  return uniqueIds;
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
  const requesterUserIds = parseRequesterUserIds(payload.requester_user_ids);
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
    new Set([...payload.requesterUserIds, ...specificApproverUserIds]),
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
  requesters: Array<{ user_id: number }>;
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
  const requesterUserIds = mergeUniqueIds([
    ...configuredRequesterIds,
    ...(config.effectiveRequesterUserIds || []),
  ]);

  return {
    module: config.module,
    requester_user_ids: requesterUserIds,
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

  const autoRequesterUserIds = await getAutoRequesterUserIdsTx(tx);
  return mapConfigResponse({
    ...config,
    effectiveRequesterUserIds: autoRequesterUserIds,
  });
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
  return prisma.$transaction(async (tx) => {
    return getConfigByModuleTx(tx, REQUISITION_MODULE);
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
          updated_by: actorUserId,
        },
        create: {
          module: normalizedPayload.module,
          is_active: normalizedPayload.isActive,
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

      await tx.requisition_approval_config_requesters.createMany({
        data: normalizedPayload.requesterUserIds.map((userId) => ({
          config_id: config.id,
          user_id: userId,
        })),
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

export const processRequisitionApprovalAction = async (args: {
  requisitionId: number;
  actorUserId: number;
  action: ApprovalAction;
  comment?: string;
}): Promise<void> => {
  const { requisitionId, actorUserId, action, comment } = args;

  try {
    await prisma.$transaction(async (tx) => {
      const request = await tx.request.findUnique({
        where: {
          id: requisitionId,
        },
        select: {
          id: true,
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

      const actionData = {
        acted_by_user_id: actorUserId,
        acted_at: new Date(),
        ...(comment !== undefined && { comment }),
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

        return;
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

        return;
      }

      await tx.request.update({
        where: {
          id: requisitionId,
        },
        data: {
          request_approval_status: RequestApprovalStatus.APPROVED,
        },
      });
    });
  } catch (error) {
    if (isRequisitionApprovalTableMissingError(error)) {
      throw new InputValidationError(
        "Requisition approval workflow tables are missing. Run database migrations first.",
      );
    }
    throw error;
  }
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
