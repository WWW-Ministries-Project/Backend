import Joi from "joi";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../../Models/context";
import {
  RequisitionPreApprovalSimilarItemsResponse,
  RequisitionApprovalActionPayload,
  RequisitionApprovalConfigPayload,
  RequisitionInterface,
} from "../../interfaces/requisitions-interface";
import {
  calculateTotalCost,
  checkPermissions,
  getApprovalData,
  updateDataPayload,
  updateRequestReturnValue,
} from "./requsition-helpers";
import {
  Prisma,
  RequestApprovalStatus,
  RequisitionApprovalModule,
} from "@prisma/client";
import { cloudinary } from "../../utils";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import {
  buildRequisitionApprovalSnapshotTx,
  getApprovalConfigByModule,
  getRequisitionApprovalConfig,
  isRequisitionApprovalTableMissingError,
  processRequisitionApprovalAction,
  triggerRequisitionNotificationEventProcessing,
  upsertRequisitionApprovalConfig,
  validateApprovalActionPayload,
} from "./requisition-approval-workflow";
import { notificationService } from "../notifications/notificationService";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS = 30;

const encodeRequisitionIdForRoute = (requisitionId: number): string =>
  Buffer.from(String(requisitionId), "utf8").toString("base64");

const buildRequisitionActionUrl = (requisitionId: number): string =>
  `/home/requests/${encodeRequisitionIdForRoute(requisitionId)}`;

const getCloudinaryPublicIdFromUrl = (attachmentUrl: string): string | null => {
  if (!attachmentUrl) return null;

  try {
    const parsedUrl = new URL(attachmentUrl);
    if (!parsedUrl.hostname.includes("res.cloudinary.com")) {
      return null;
    }

    const uploadIndex = parsedUrl.pathname.indexOf("/upload/");
    if (uploadIndex < 0) {
      return null;
    }

    let publicIdPath = parsedUrl.pathname.slice(uploadIndex + "/upload/".length);
    publicIdPath = publicIdPath.replace(/^v\d+\//, "");

    const segments = publicIdPath.split("/").filter(Boolean);
    if (!segments.length) {
      return null;
    }

    // Cloudinary URLs can have transformations before the version/public-id.
    while (
      segments.length > 1 &&
      segments[0].includes(",") &&
      !segments[0].startsWith("v")
    ) {
      segments.shift();
    }

    if (segments[0] && /^v\d+$/.test(segments[0])) {
      segments.shift();
    }

    if (!segments.length) {
      return null;
    }

    const lastSegment = segments[segments.length - 1];
    segments[segments.length - 1] = lastSegment.replace(/\.[^/.]+$/, "");

    const publicId = segments.join("/");
    return publicId || null;
  } catch (error) {
    return null;
  }
};

const getLocalAttachmentPath = (attachmentUrl: string): string | null => {
  if (!attachmentUrl) return null;

  const resolveUploadsPath = (candidate: string) => {
    const resolved = path.resolve(process.cwd(), candidate.replace(/^\/+/, ""));
    return resolved.startsWith(UPLOADS_DIR) ? resolved : null;
  };

  try {
    const parsedUrl = new URL(attachmentUrl);
    const decodedPath = decodeURIComponent(parsedUrl.pathname || "");
    if (decodedPath.includes("/uploads/")) {
      return resolveUploadsPath(decodedPath);
    }
    return null;
  } catch (error) {
    if (
      attachmentUrl.startsWith("uploads/") ||
      attachmentUrl.startsWith("/uploads/")
    ) {
      return resolveUploadsPath(attachmentUrl);
    }

    if (
      path.isAbsolute(attachmentUrl) &&
      attachmentUrl.startsWith(UPLOADS_DIR)
    ) {
      return attachmentUrl;
    }

    return null;
  }
};

const deleteAttachmentImages = async (attachmentUrls: string[] = []) => {
  const uniqueUrls = Array.from(new Set(attachmentUrls.filter(Boolean)));

  await Promise.allSettled(
    uniqueUrls.map(async (attachmentUrl) => {
      const publicId = getCloudinaryPublicIdFromUrl(attachmentUrl);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId);
        return;
      }

      const localAttachmentPath = getLocalAttachmentPath(attachmentUrl);
      if (localAttachmentPath) {
        await fs.unlink(localAttachmentPath);
      }
    }),
  );
};

const mapRequestToSummary = (request: {
  id: number;
  user_id: number;
  request_id: string;
  requisition_date: Date;
  request_approval_status: RequestApprovalStatus;
  department_id: number;
  department: { name: string };
  user: {
    name: string;
    position: { name: string } | null;
  };
  products: { name: string; unitPrice: number; quantity: number }[];
}, editMetadata?: {
  updated_by_name?: string | null;
  updated_at?: Date | string | null;
}) => ({
  requisition_id: request.id,
  user_id: request.user_id,
  generated_id: request.request_id,
  product_names: request.products.map((product) => product.name),
  date_created: request.requisition_date,
  approval_status: request.request_approval_status,
  total_amount: request.products.reduce(
    (sum, product) => sum + product.unitPrice * product.quantity,
    0,
  ),
  department_id: request.department_id,
  requester_name: request.user.name,
  requester_department_name: request.department.name,
  requester_department: request.department.name,
  requester_position: request.user.position?.name || null,
  updated_by_name: editMetadata?.updated_by_name || null,
  edited_by_name: editMetadata?.updated_by_name || null,
  updated_at: editMetadata?.updated_at || null,
  edited_at: editMetadata?.updated_at || null,
});

type RequisitionEditMetadataRow = {
  requisition_id: number;
  updated_by_name: string | null;
  updated_at: Date | null;
};

const getRequisitionEditMetadataMap = async (requisitionIds: number[]) => {
  const ids = Array.from(
    new Set(
      requisitionIds.filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (!ids.length) {
    return new Map<number, RequisitionEditMetadataRow>();
  }

  const rows = await prisma.$queryRaw<RequisitionEditMetadataRow[]>(Prisma.sql`
    SELECT
      r.id AS requisition_id,
      editor.name AS updated_by_name,
      r.updated_at AS updated_at
    FROM \`request\` r
    LEFT JOIN \`user\` editor ON editor.id = r.updated_by_user_id
    WHERE r.id IN (${Prisma.join(ids)})
  `);

  return new Map<number, RequisitionEditMetadataRow>(
    rows.map((row) => [Number(row.requisition_id), row]),
  );
};

const areDatesEqual = (
  firstDate: Date | null | undefined,
  secondDate: Date | null | undefined,
) => {
  if (!firstDate && !secondDate) return true;
  if (!firstDate || !secondDate) return false;
  return firstDate.getTime() === secondDate.getTime();
};

const buildChangedFields = (args: {
  incomingData: Partial<RequisitionInterface>;
  existingRequest: {
    requisition_date: Date;
    department_id: number;
    event_id: number | null;
    request_approval_status: RequestApprovalStatus;
    currency: string;
    user_sign: string | null;
  };
  hasProductsChange: boolean;
  hasAttachmentsChange: boolean;
}) => {
  const { incomingData, existingRequest, hasProductsChange, hasAttachmentsChange } =
    args;
  const changedFields: string[] = [];

  if (incomingData.request_date !== undefined) {
    const nextRequestDate = new Date(incomingData.request_date);
    if (
      !Number.isNaN(nextRequestDate.getTime()) &&
      !areDatesEqual(nextRequestDate, existingRequest.requisition_date)
    ) {
      changedFields.push("request_date");
    }
  }

  if (
    incomingData.department_id !== undefined &&
    incomingData.department_id !== existingRequest.department_id
  ) {
    changedFields.push("department_id");
  }

  if (
    incomingData.event_id !== undefined &&
    incomingData.event_id !== existingRequest.event_id
  ) {
    changedFields.push("event_id");
  }

  if (
    incomingData.currency !== undefined &&
    incomingData.currency !== existingRequest.currency
  ) {
    changedFields.push("currency");
  }

  if (
    incomingData.user_sign !== undefined &&
    incomingData.user_sign !== existingRequest.user_sign
  ) {
    changedFields.push("user_sign");
  }

  if (
    incomingData.approval_status !== undefined &&
    incomingData.approval_status !== existingRequest.request_approval_status
  ) {
    changedFields.push("approval_status");
  }

  if (incomingData.comment !== undefined) {
    changedFields.push("comment");
  }

  if (hasProductsChange) {
    changedFields.push("products");
  }

  if (hasAttachmentsChange) {
    changedFields.push("attachmentLists");
  }

  return Array.from(new Set(changedFields));
};

const applyRequisitionEditAuditTx = async (
  tx: Prisma.TransactionClient,
  payload: {
    requisitionId: number;
    editorUserId: number;
    editedAt?: Date;
    changedFields: string[];
  },
) => {
  const editedAt = payload.editedAt || new Date();
  const changedFieldsValue = JSON.stringify(payload.changedFields || []);

  await tx.$executeRaw`
    UPDATE \`request\`
    SET updated_by_user_id = ${payload.editorUserId},
        updated_at = ${editedAt}
    WHERE id = ${payload.requisitionId}
  `;

  await tx.$executeRaw`
    INSERT INTO \`requisition_edit_logs\` (requisition_id, editor_user_id, edited_at, changed_fields)
    VALUES (${payload.requisitionId}, ${payload.editorUserId}, ${editedAt}, ${changedFieldsValue})
  `;

  return editedAt;
};

const stripApprovalInstanceFilters = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripApprovalInstanceFilters(item))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "approval_instances") {
      continue;
    }

    const transformed = stripApprovalInstanceFilters(nestedValue);
    if (transformed === undefined) {
      continue;
    }
    if (
      Array.isArray(transformed) &&
      ["OR", "AND", "NOT"].includes(key) &&
      !transformed.length
    ) {
      continue;
    }
    output[key] = transformed;
  }

  return Object.keys(output).length ? output : undefined;
};

const parsePermissionObject = (permissions: any): Record<string, any> => {
  if (!permissions) return {};

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return {};

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions);
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Record<string, any>;
      }
    } catch (error) {
      return {};
    }

    return {};
  }

  if (typeof permissions === "object" && !Array.isArray(permissions)) {
    return permissions as Record<string, any>;
  }

  return {};
};

const getAuthenticatedUserId = (user: any): number => {
  const actorUserId = Number(user?.id);
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    throw new UnauthorizedError("Authenticated user not found");
  }

  return actorUserId;
};

const hasRequisitionManagePermission = (user: any): boolean => {
  const permissions = parsePermissionObject(user?.permissions);
  const permissionValue =
    permissions?.Requisition || permissions?.Requisitions || null;

  return (
    permissionValue === "Can_Manage" || permissionValue === "Super_Admin"
  );
};

const ensureRequisitionAccess = (user: any, requisitionOwnerId: number) => {
  const actorUserId = getAuthenticatedUserId(user);
  if (
    actorUserId !== requisitionOwnerId &&
    !hasRequisitionManagePermission(user)
  ) {
    throw new UnauthorizedError(
      "You do not have permission to access this requisition",
    );
  }
};

const isMissingWorkflowTablesError = (error: unknown): boolean => {
  return (
    isRequisitionApprovalTableMissingError(error) ||
    (error instanceof InputValidationError &&
      error.message.includes("workflow tables are missing"))
  );
};

const isApprovalChainAlreadyExistsError = (error: unknown): boolean => {
  return (
    error instanceof InputValidationError &&
    error.message.includes("Approval chain already exists for this requisition")
  );
};

const parseBooleanLike = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;

  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
};

const normalizeItemName = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
};

const parseOptionalPositiveInteger = (
  value: unknown,
  fieldName: string,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputValidationError(`${fieldName} must be a positive integer`);
  }

  return parsed;
};

const normalizeOptionalEventIdValue = (
  value: unknown,
): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "null" || normalized === "none") {
      return null;
    }
  }

  const parsed = Number(value);
  if (parsed === 0) {
    return null;
  }

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InputValidationError("If provided, event must be a valid event id");
  }

  return parsed;
};

const normalizeCreateEventId = (value: unknown): number | null => {
  return normalizeOptionalEventIdValue(value);
};

const normalizeUpdateEventId = (
  payload: Partial<RequisitionInterface>,
): number | null | undefined => {
  if (!Object.prototype.hasOwnProperty.call(payload, "event_id")) {
    return undefined;
  }

  return normalizeOptionalEventIdValue((payload as any).event_id);
};

const shouldSubmitOnCreate = (data: RequisitionInterface): boolean => {
  const hasExplicitSubmitFlag = parseBooleanLike(
    (data as any).submit_for_approval ??
      (data as any).submitForApproval ??
      (data as any).auto_submit ??
      (data as any).autoSubmit,
  );

  const hasSubmittedStatus =
    data.approval_status !== undefined &&
    data.approval_status !== RequestApprovalStatus.Draft;

  return hasExplicitSubmitFlag || hasSubmittedStatus;
};

const notifyRequisitionCommentParticipants = async (args: {
  requisitionId: number;
  actorUserId: number;
  comment: string;
}) => {
  const trimmedComment = String(args.comment || "").trim();
  if (!trimmedComment) {
    return;
  }

  const requisition = await prisma.request.findUnique({
    where: {
      id: args.requisitionId,
    },
    select: {
      id: true,
      request_id: true,
      user_id: true,
      request_approval_status: true,
    },
  });

  if (
    !requisition ||
    requisition.request_approval_status === RequestApprovalStatus.Draft
  ) {
    return;
  }

  let currentPendingApproverUserId: number | null = null;
  try {
    const pendingStep = await prisma.requisition_approval_instances.findFirst({
      where: {
        request_id: requisition.id,
        status: "PENDING",
      },
      orderBy: {
        step_order: "asc",
      },
      select: {
        approver_user_id: true,
      },
    });

    currentPendingApproverUserId = pendingStep?.approver_user_id || null;
  } catch (error) {
    if (!isMissingWorkflowTablesError(error)) {
      throw error;
    }
  }

  const recipientUserIds = Array.from(
    new Set(
      [requisition.user_id, currentPendingApproverUserId]
        .map((id) => Number(id))
        .filter(
          (id): id is number =>
            Number.isInteger(id) && id > 0 && id !== args.actorUserId,
        ),
    ),
  );

  if (!recipientUserIds.length) {
    return;
  }

  const requisitionReference = requisition.request_id || `#${requisition.id}`;
  const shortComment =
    trimmedComment.length > 220
      ? `${trimmedComment.slice(0, 217)}...`
      : trimmedComment;

  await notificationService.createManyInAppNotifications(
    recipientUserIds.map((recipientUserId) => ({
      type: "requisition.comment_added",
      title: "New requisition comment",
      body: `A new comment was added on requisition ${requisitionReference}: ${shortComment}`,
      recipientUserId,
      actorUserId: args.actorUserId,
      entityType: "REQUISITION",
      entityId: String(requisition.id),
      actionUrl: buildRequisitionActionUrl(requisition.id),
      priority: "MEDIUM",
      dedupeKey: `requisition:${requisition.id}:comment:${args.actorUserId}:${recipientUserId}:${Buffer.from(
        shortComment,
        "utf8",
      ).toString("base64").slice(0, 32)}`,
      sendSms: true,
      smsBody: `New comment on requisition ${requisitionReference}: ${shortComment}`,
    })),
  );
};

const getRequisitionSummaryFromRequests = async (where?: any) => {
  let requests;
  try {
    requests = await prisma.request.findMany({
      where,
      include: {
        products: {
          select: {
            name: true,
            unitPrice: true,
            quantity: true,
          },
        },
        user: {
          select: {
            name: true,
            position: {
              select: {
                name: true,
              },
            },
          },
        },
        department: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    });
  } catch (error) {
    if (!isMissingWorkflowTablesError(error)) {
      throw error;
    }

    const fallbackWhere = stripApprovalInstanceFilters(where);
    requests = await prisma.request.findMany({
      where: fallbackWhere,
      include: {
        products: {
          select: {
            name: true,
            unitPrice: true,
            quantity: true,
          },
        },
        user: {
          select: {
            name: true,
            position: {
              select: {
                name: true,
              },
            },
          },
        },
        department: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    });
  }

  const editMetadataMap = await getRequisitionEditMetadataMap(
    requests.map((request) => request.id),
  );

  return requests.map((request) =>
    mapRequestToSummary(request, editMetadataMap.get(request.id)),
  );
};

const resolveLegacySubmissionState = async (
  tx: Prisma.TransactionClient,
  payload: {
    requesterId: number;
    departmentId: number;
    userSign?: string;
  },
) => {
  const { requesterId, departmentId, userSign } = payload;
  const department = await tx.department.findUnique({
    where: { id: departmentId },
    select: { department_head: true },
  });

  const shouldAutoApproveByHOD =
    Boolean(userSign?.trim()) && department?.department_head === requesterId;

  return {
    requestApprovalStatus: shouldAutoApproveByHOD
      ? RequestApprovalStatus.Awaiting_Executive_Pastor_Approval
      : RequestApprovalStatus.Awaiting_HOD_Approval,
    approvalData: {
      hod_user_id: shouldAutoApproveByHOD ? requesterId : null,
      hod_approved: shouldAutoApproveByHOD,
      hod_approval_date: shouldAutoApproveByHOD ? new Date() : null,
      hod_sign: shouldAutoApproveByHOD ? userSign || null : null,
      ps_user_id: null,
      ps_approved: false,
      ps_approval_date: null,
      ps_sign: null,
    },
  };
};

const applyLegacySubmissionTx = async (
  tx: Prisma.TransactionClient,
  payload: {
    requestId: number;
    requesterId: number;
    departmentId: number;
    userSign?: string;
  },
) => {
  const { requestApprovalStatus, approvalData } = await resolveLegacySubmissionState(
    tx,
    {
      requesterId: payload.requesterId,
      departmentId: payload.departmentId,
      userSign: payload.userSign,
    },
  );

  await tx.request.update({
    where: { id: payload.requestId },
    data: {
      request_approval_status: requestApprovalStatus,
    },
  });

  await tx.request_approvals.upsert({
    where: {
      request_id: payload.requestId,
    },
    update: approvalData,
    create: {
      request_id: payload.requestId,
      ...approvalData,
    },
  });
};

const processLegacyRequisitionApprovalAction = async (args: {
  requisitionId: number;
  actorUserId: number;
  action: "APPROVE" | "REJECT";
  actorPermission?: string;
}): Promise<void> => {
  const { requisitionId, actorUserId, action, actorPermission } = args;
  const isHOD = actorPermission === "Can_Manage";
  const isPastor = actorPermission === "Super_Admin";

  await prisma.$transaction(async (tx) => {
    const requisition = await tx.request.findUnique({
      where: { id: requisitionId },
      select: {
        id: true,
        request_approval_status: true,
      },
    });

    if (!requisition) {
      throw new NotFoundError("Requisition not found");
    }

    if (
      requisition.request_approval_status === RequestApprovalStatus.APPROVED ||
      requisition.request_approval_status === RequestApprovalStatus.REJECTED
    ) {
      throw new InputValidationError("Requisition is already closed");
    }

    if (action === "REJECT") {
      if (!isHOD && !isPastor) {
        throw new UnauthorizedError("You do not have approval rights for this requisition");
      }

      await tx.request.update({
        where: { id: requisitionId },
        data: { request_approval_status: RequestApprovalStatus.REJECTED },
      });
      return;
    }

    if (requisition.request_approval_status === RequestApprovalStatus.Awaiting_HOD_Approval) {
      if (!isHOD && !isPastor) {
        throw new UnauthorizedError("HOD approval permission is required");
      }

      await tx.request_approvals.upsert({
        where: { request_id: requisitionId },
        update: {
          hod_user_id: actorUserId,
          hod_approved: true,
          hod_approval_date: new Date(),
        },
        create: {
          request_id: requisitionId,
          hod_user_id: actorUserId,
          hod_approved: true,
          hod_approval_date: new Date(),
        },
      });

      await tx.request.update({
        where: { id: requisitionId },
        data: {
          request_approval_status: RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
        },
      });
      return;
    }

    if (
      requisition.request_approval_status ===
      RequestApprovalStatus.Awaiting_Executive_Pastor_Approval
    ) {
      if (!isPastor) {
        throw new UnauthorizedError("Executive pastor approval permission is required");
      }

      await tx.request_approvals.upsert({
        where: { request_id: requisitionId },
        update: {
          ps_user_id: actorUserId,
          ps_approved: true,
          ps_approval_date: new Date(),
        },
        create: {
          request_id: requisitionId,
          ps_user_id: actorUserId,
          ps_approved: true,
          ps_approval_date: new Date(),
        },
      });

      await tx.request.update({
        where: { id: requisitionId },
        data: {
          request_approval_status: RequestApprovalStatus.APPROVED,
        },
      });
      return;
    }

    throw new InputValidationError("Requisition is not in an approvable state");
  });
};

/**
 * Generates the next request ID.
 * @returns {Promise<string>} The next request ID in the format "RQ-0001"
 */
export const generateRequestId = async (): Promise<string> => {
  const lastRequest = await prisma.request.findFirst({
    orderBy: { id: "desc" },
  });

  const nextId = lastRequest ? lastRequest.id + 1 : 1;
  return `RQ-${String(nextId).padStart(4, "0")}`;
};

/**
 * Creates a new requisition in the database.
 * @param {RequisitionInterface} data The data for the new requisition.
 * @returns {Promise<RequisitionInterface>} The newly created requisition.
 */
export const createRequisition = async (
  data: RequisitionInterface,
  user: any,
) => {
  if (!data.request_date) {
    throw new InputValidationError("Request date is required.");
  }

  const actorUserId = getAuthenticatedUserId(user);
  const requestId = await generateRequestId();
  const shouldSubmit = shouldSubmitOnCreate(data);
  const normalizedEventId = normalizeCreateEventId((data as any).event_id);
  const requestCreateData: Prisma.requestUncheckedCreateInput = {
    request_id: requestId,
    user_sign: data.user_sign,
    user_id: actorUserId,
    department_id: data.department_id,
    event_id: normalizedEventId,
    requisition_date: new Date(data.request_date as string),
    request_approval_status: RequestApprovalStatus.Draft,
    currency: data.currency,

    // Create the products related to the request
    products: data.products?.length
      ? {
          create: data.products.map((product) => ({
            name: product.name,
            unitPrice: product.unitPrice,
            quantity: product.quantity,
            image_url: product.image_url,
          })),
        }
      : undefined,
    request_approvals: {
      create: {},
    },
    // Create the attachments list for the request, if provided
    attachmentsList: data.attachmentLists?.length
      ? {
          create: data.attachmentLists.map((attachment) => ({
            URL: attachment.URL,
          })),
        }
      : undefined,
  };

  let shouldTriggerNotificationProcessing = false;

  const createdRequest = await prisma.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: requestCreateData,
      select: {
        id: true,
        user_id: true,
        department_id: true,
        user_sign: true,
      },
    });

    if (data.comment) {
      await tx.request_comments.create({
        data: {
          request_id: request.id,
          comment: data.comment,
          user_id: request.user_id,
        },
      });
    }

    if (shouldSubmit) {
      try {
        await buildRequisitionApprovalSnapshotTx(tx, {
          requestId: request.id,
          requesterId: request.user_id,
          fallbackDepartmentId: request.department_id,
        });
        shouldTriggerNotificationProcessing = true;
      } catch (error) {
        if (!isMissingWorkflowTablesError(error)) {
          throw error;
        }

        await applyLegacySubmissionTx(tx, {
          requestId: request.id,
          requesterId: request.user_id,
          departmentId: request.department_id,
          userSign: data.user_sign,
        });
      }
    }

    return request;
  });

  if (shouldTriggerNotificationProcessing) {
    triggerRequisitionNotificationEventProcessing();
  }

  return getRequisition(createdRequest.id, user);
};

/**
 * Updates an existing requisition by its ID.
 * @param {Partial<RequisitionInterface>} data The data to update the requisition with.
 * @param {any} user The user making the update request.
 * @returns {Promise<RequisitionInterface>} The updated requisition, including all its products and attachments.
 */
/**
 * @typedef {Object} RequisitionSummary
 
 */
export const updateRequisition = async (
  data: Partial<RequisitionInterface>,
  user: any,
) => {
  if (!data.id) {
    throw new InputValidationError("Requisition ID is required for updates.");
  }

  const token_user_id = getAuthenticatedUserId(user);
  const updateInput: Partial<RequisitionInterface> = { ...data };
  // Requester identity is immutable after creation.
  delete (updateInput as any).user_id;
  updateInput.event_id = normalizeUpdateEventId(updateInput);

  const [
    findRequest,
    existingApproval,
    existingAttachments,
    existingProducts,
  ] =
    await prisma.$transaction([
      prisma.request.findUnique({
        where: { id: data.id },
      }),
      prisma.request_approvals.findUnique({
        where: { request_id: data.id },
      }),
      prisma.request_attachment.findMany({
        where: { request_id: data.id },
        select: { id: true },
      }),
      prisma.requested_item.findMany({
        where: { request_id: data.id },
        select: { id: true },
      }),
    ]);

  let existingApprovalInstance: { id: number } | null = null;
  try {
    existingApprovalInstance = await prisma.requisition_approval_instances.findFirst({
      where: { request_id: data.id },
      select: { id: true },
    });
  } catch (error) {
    if (!isMissingWorkflowTablesError(error)) {
      throw error;
    }
  }

  if (!findRequest) {
    throw new NotFoundError("Requisition not found");
  }
  // check if logged user has permission to update the requisition
  const { isHOD, isPastor, isMember } = checkPermissions(
    user,
    findRequest.user_id,
  );

  const hasApprovalWorkflow = Boolean(existingApprovalInstance);
  const isSignedAction = Boolean(updateInput.user_sign?.trim());

  if (hasApprovalWorkflow && !isMember && isSignedAction) {
    const action =
      updateInput.approval_status === RequestApprovalStatus.REJECTED
        ? "REJECT"
        : "APPROVE";

    await processRequisitionApprovalAction({
      requisitionId: data.id,
      actorUserId: token_user_id,
      action,
      ...(updateInput.comment && { comment: updateInput.comment }),
    });

    const approvalChangedFields = Array.from(
      new Set([
        "approval_status",
        ...(updateInput.user_sign !== undefined ? ["user_sign"] : []),
        ...(updateInput.comment !== undefined ? ["comment"] : []),
      ]),
    );

    await prisma.$transaction(async (tx) => {
      if (updateInput.comment) {
        await tx.request_comments.create({
          data: {
            request_id: data.id,
            comment: updateInput.comment,
            user_id: token_user_id,
          },
        });
      }

      await applyRequisitionEditAuditTx(tx, {
        requisitionId: data.id as number,
        editorUserId: token_user_id,
        changedFields: approvalChangedFields,
      });
    });

    if (updateInput.comment) {
      await notifyRequisitionCommentParticipants({
        requisitionId: data.id as number,
        actorUserId: token_user_id,
        comment: updateInput.comment,
      });
    }

    return getRequisition(data.id, user);
  }

  const incomingAttachments = updateInput.attachmentLists || [];
  const incomingProducts = updateInput.products || [];

  const newAttachments = incomingAttachments.filter(
    (attachment) => typeof attachment.id !== "number",
  );
  const attachmentsToUpdate = incomingAttachments.filter((attachment) =>
    typeof attachment.id === "number" &&
    existingAttachments.some((ea) => ea.id === attachment.id),
  );
  const attachmentsToDelete = updateInput.attachmentLists
    ? existingAttachments.filter(
        (ea) => !incomingAttachments.some((ia) => ia.id === ea.id),
      )
    : [];

  const newProducts = incomingProducts.filter(
    (product) => typeof product.id !== "number",
  );
  const productsToUpdate = incomingProducts.filter(
    (product) =>
      typeof product.id === "number" &&
      existingProducts.some((existingProduct) => existingProduct.id === product.id),
  );
  const productsToDelete = updateInput.products
    ? existingProducts.filter(
        (existingProduct) =>
          !incomingProducts.some((incomingProduct) => incomingProduct.id === existingProduct.id),
      )
    : [];

  const hasProductsChange = Boolean(
    newProducts.length || productsToUpdate.length || productsToDelete.length,
  );
  const hasAttachmentsChange = Boolean(
    newAttachments.length || attachmentsToUpdate.length || attachmentsToDelete.length,
  );

  const { requestApprovalStatus, approvalData } = getApprovalData(
    updateInput,
    token_user_id,
    isHOD,
    isPastor,
    isMember,
  );

  const shouldSubmitByRequester =
    isMember &&
    isSignedAction &&
    !hasApprovalWorkflow &&
    findRequest.request_approval_status === RequestApprovalStatus.Draft;

  const changedFields = buildChangedFields({
    incomingData: updateInput,
    existingRequest: {
      requisition_date: findRequest.requisition_date,
      department_id: findRequest.department_id,
      event_id: findRequest.event_id,
      request_approval_status: findRequest.request_approval_status,
      currency: findRequest.currency,
      user_sign: findRequest.user_sign,
    },
    hasProductsChange,
    hasAttachmentsChange,
  });
  const effectiveChangedFields = shouldSubmitByRequester
    ? Array.from(new Set([...changedFields, "approval_status"]))
    : changedFields;

  const effectiveRequestApprovalStatus = shouldSubmitByRequester
    ? findRequest.request_approval_status
    : requestApprovalStatus;

  // Build the update payload
  const updateData = updateDataPayload(
    updateInput,
    isMember,
    effectiveRequestApprovalStatus,
    productsToUpdate,
    newProducts,
    attachmentsToUpdate,
    newAttachments,
  );

  let shouldTriggerNotificationProcessing = false;

  await prisma.$transaction(async (tx) => {
    if (existingApproval) {
      await tx.request_approvals.update({
        where: { request_id: data.id },
        data: {
          ...approvalData,
        },
      });
    } else {
      await tx.request_approvals.create({
        data: {
          request_id: data.id,
          ...approvalData,
        },
      });
    }

    if (updateInput.comment) {
      const commentData = {
        request_id: data.id,
        comment: updateInput.comment,
        user_id: token_user_id,
      };

      if (updateInput.comment_id) {
        // Update existing comment
        await tx.request_comments.update({
          where: { id: updateInput.comment_id },
          data: { comment: updateInput.comment },
        });
      } else {
        // Create new comment
        await tx.request_comments.create({ data: commentData });
      }
    }

    // Update the requisition
    await tx.request.update({
      where: { id: data.id },
      data: updateData as Prisma.requestUncheckedUpdateInput,
    });

    // Delete omitted requested items
    if (productsToDelete.length) {
      await tx.requested_item.deleteMany({
        where: { id: { in: productsToDelete.map((product) => product.id) } },
      });
    }

    // Delete omitted attachments
    if (attachmentsToDelete.length) {
      await tx.request_attachment.deleteMany({
        where: { id: { in: attachmentsToDelete.map((attachment) => attachment.id) } },
      });
    }

    if (shouldSubmitByRequester) {
      try {
        await buildRequisitionApprovalSnapshotTx(tx, {
          requestId: data.id as number,
          requesterId: findRequest.user_id,
          fallbackDepartmentId: findRequest.department_id,
        });
        shouldTriggerNotificationProcessing = true;
      } catch (error) {
        if (!isMissingWorkflowTablesError(error)) {
          throw error;
        }

        await applyLegacySubmissionTx(tx, {
          requestId: data.id as number,
          requesterId: findRequest.user_id,
          departmentId: findRequest.department_id,
          userSign: updateInput.user_sign,
        });
      }
    }

    await applyRequisitionEditAuditTx(tx, {
      requisitionId: data.id as number,
      editorUserId: token_user_id,
      changedFields: effectiveChangedFields,
    });
  });

  if (shouldTriggerNotificationProcessing) {
    triggerRequisitionNotificationEventProcessing();
  }

  if (updateInput.comment) {
    await notifyRequisitionCommentParticipants({
      requisitionId: data.id as number,
      actorUserId: token_user_id,
      comment: updateInput.comment,
    });
  }

  // Return the latest record shape after deletions.
  return getRequisition(data.id, user);
};

/**
 * Deletes a requisition and its related products and attachments.
 * @param {any} id The ID of the requisition to delete.
 * @returns {Promise<{message: string}>} A promise containing a message indicating the success of the deletion.
 */
export const deleteRequisition = async (id: any, user: any) => {
  await Joi.object({
    id: Joi.required(),
  }).validateAsync({ id });

  const parsedId = parseInt(id, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new InputValidationError("A valid requisition id is required");
  }

  const requisition = await prisma.request.findUnique({
    where: { id: parsedId },
    select: {
      id: true,
      user_id: true,
      attachmentsList: {
        select: {
          URL: true,
        },
      },
    },
  });

  if (!requisition) {
    throw new NotFoundError(`Requisition with ID ${id} not found.`);
  }

  ensureRequisitionAccess(user, requisition.user_id);

  const attachmentUrls = requisition.attachmentsList.map(
    (attachment) => attachment.URL,
  );

  const result = await prisma.$transaction([
    prisma.requested_item.deleteMany({
      where: { request_id: parsedId },
    }),
    prisma.request_attachment.deleteMany({
      where: { request_id: parsedId },
    }),
    prisma.request.delete({
      where: { id: parsedId },
    }),
  ]);

  await deleteAttachmentImages(attachmentUrls);

  return result;
};

export const listRequisition = async (user: any) => {
  const actorUserId = getAuthenticatedUserId(user);
  if (hasRequisitionManagePermission(user)) {
    return getRequisitionSummaryFromRequests();
  }

  return getRequisitionSummaryFromRequests({
    user_id: actorUserId,
  });
};

export const getmyRequisition = async (user: any) => {
  const userId = getAuthenticatedUserId(user);
  return getRequisitionSummaryFromRequests({
    user_id: userId,
  });
};

export const saveRequisitionApprovalConfig = async (
  payload: RequisitionApprovalConfigPayload,
  actorUserId?: number,
) => {
  const requestedModule = payload?.module;
  if (
    requestedModule !== undefined &&
    requestedModule !== RequisitionApprovalModule.REQUISITION
  ) {
    throw new InputValidationError(
      "Use the event report approval config endpoint for EVENT_REPORT module",
    );
  }

  return upsertRequisitionApprovalConfig(
    {
      ...payload,
      module: RequisitionApprovalModule.REQUISITION,
    },
    actorUserId,
  );
};

export const fetchRequisitionApprovalConfig = async () => {
  return getApprovalConfigByModule(RequisitionApprovalModule.REQUISITION);
};

const resolveSimilarItemLookbackDays = async (
  requestedDays: unknown,
): Promise<number> => {
  const explicitDays = parseOptionalPositiveInteger(
    requestedDays,
    "days",
  );
  if (explicitDays) {
    return explicitDays;
  }

  try {
    const config = await getRequisitionApprovalConfig();
    const configuredDays = Number(config?.similar_item_lookback_days);
    if (Number.isInteger(configuredDays) && configuredDays > 0) {
      return configuredDays;
    }
  } catch (error) {
    if (!isMissingWorkflowTablesError(error)) {
      throw error;
    }
  }

  return DEFAULT_SIMILAR_ITEM_LOOKBACK_DAYS;
};

type SimilarItemMatchRow = {
  item_name: string;
  image_url: string | null;
  quantity: number;
  requisition_id: number;
  generated_id: string;
  request_date: Date;
  requester_name: string | null;
  status: RequestApprovalStatus;
};

export const getPreApprovalSimilarItems = async (
  requisitionId: unknown,
  days?: unknown,
): Promise<RequisitionPreApprovalSimilarItemsResponse> => {
  const parsedRequisitionId = Number(requisitionId);
  if (!Number.isInteger(parsedRequisitionId) || parsedRequisitionId <= 0) {
    throw new InputValidationError("requisition_id must be a positive integer");
  }

  const lookbackDays = await resolveSimilarItemLookbackDays(days);
  const lookbackStartDate = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  );

  const requisition = await prisma.request.findUnique({
    where: {
      id: parsedRequisitionId,
    },
    select: {
      id: true,
      products: {
        select: {
          name: true,
          image_url: true,
        },
      },
    },
  });

  if (!requisition) {
    throw new NotFoundError("Requisition not found");
  }

  const groupedItems = new Map<
    string,
    {
      current_item_name: string;
      current_item_image_url: string | null;
      matches: RequisitionPreApprovalSimilarItemsResponse["matched_items"][number]["matches"];
    }
  >();

  for (const item of requisition.products) {
    const normalizedName = normalizeItemName(item.name);
    if (!normalizedName) {
      continue;
    }

    if (!groupedItems.has(normalizedName)) {
      groupedItems.set(normalizedName, {
        current_item_name: item.name.trim() || item.name,
        current_item_image_url: item.image_url || null,
        matches: [],
      });
      continue;
    }

    const existingGroup = groupedItems.get(normalizedName);
    if (existingGroup && !existingGroup.current_item_image_url && item.image_url) {
      existingGroup.current_item_image_url = item.image_url;
    }
  }

  const normalizedCurrentItemNames = Array.from(groupedItems.keys());
  if (!normalizedCurrentItemNames.length) {
    return {
      lookback_days_used: lookbackDays,
      matched_items: [],
    };
  }

  const matchRows = await prisma.$queryRaw<SimilarItemMatchRow[]>(Prisma.sql`
    SELECT
      ri.name AS item_name,
      ri.image_url AS image_url,
      ri.quantity AS quantity,
      r.id AS requisition_id,
      r.request_id AS generated_id,
      r.requisition_date AS request_date,
      requester.name AS requester_name,
      r.request_approval_status AS status
    FROM \`requested_product_item\` ri
    INNER JOIN \`request\` r
      ON r.id = ri.request_id
    LEFT JOIN \`user\` requester
      ON requester.id = r.user_id
    WHERE
      (
        r.requisition_date >= ${lookbackStartDate}
        OR r.id = ${parsedRequisitionId}
      )
      AND LOWER(TRIM(ri.name)) IN (${Prisma.join(normalizedCurrentItemNames)})
    ORDER BY r.requisition_date DESC, r.id DESC, ri.id DESC
  `);

  for (const row of matchRows) {
    const normalizedName = normalizeItemName(row.item_name);
    const group = groupedItems.get(normalizedName);
    if (!group) {
      continue;
    }

    group.matches.push({
      item_name: row.item_name,
      image_url: row.image_url || null,
      requisition_id: Number(row.requisition_id),
      generated_id: row.generated_id,
      request_date: new Date(row.request_date),
      requester_name: row.requester_name || null,
      status: row.status,
      quantity: Number(row.quantity),
    });
  }

  return {
    lookback_days_used: lookbackDays,
    matched_items: Array.from(groupedItems.values()),
  };
};

export const submitRequisition = async (requisitionId: unknown, user: any) => {
  const parsedId = Number(requisitionId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new InputValidationError("A valid requisition id is required");
  }

  const requesterId = Number(user?.id);
  if (!Number.isInteger(requesterId) || requesterId <= 0) {
    throw new UnauthorizedError("Authenticated user not found");
  }

  let shouldTriggerNotificationProcessing = false;

  await prisma.$transaction(async (tx) => {
    const requisition = await tx.request.findUnique({
      where: {
        id: parsedId,
      },
      select: {
        id: true,
        user_id: true,
        department_id: true,
        user_sign: true,
        request_approval_status: true,
      },
    });

    if (!requisition) {
      throw new NotFoundError("Requisition not found");
    }

    if (requisition.user_id !== requesterId) {
      throw new UnauthorizedError("Only the requester can submit this requisition");
    }

    // Idempotent submit: once submitted/processed, a repeated submit should be a no-op.
    if (requisition.request_approval_status !== RequestApprovalStatus.Draft) {
      return;
    }

    try {
      await buildRequisitionApprovalSnapshotTx(tx, {
        requestId: requisition.id,
        requesterId: requisition.user_id,
        fallbackDepartmentId: requisition.department_id,
      });
      shouldTriggerNotificationProcessing = true;
    } catch (error) {
      if (isApprovalChainAlreadyExistsError(error)) {
        await tx.request.update({
          where: { id: requisition.id },
          data: {
            request_approval_status: RequestApprovalStatus.Awaiting_HOD_Approval,
          },
        });
        return;
      }

      if (!isMissingWorkflowTablesError(error)) {
        throw error;
      }

      await applyLegacySubmissionTx(tx, {
        requestId: requisition.id,
        requesterId: requisition.user_id,
        departmentId: requisition.department_id,
        userSign: requisition.user_sign || undefined,
      });
    }
  });

  if (shouldTriggerNotificationProcessing) {
    triggerRequisitionNotificationEventProcessing();
  }

  return getRequisition(parsedId, user);
};

export const actionRequisitionApproval = async (
  payload: RequisitionApprovalActionPayload,
  user: any,
) => {
  const actorUserId = Number(user?.id);
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    throw new UnauthorizedError("Authenticated user not found");
  }

  const validated = validateApprovalActionPayload(payload);

  try {
    await processRequisitionApprovalAction({
      requisitionId: validated.requisitionId,
      actorUserId,
      action: validated.action,
      comment: validated.comment,
    });
  } catch (error) {
    const isMissingWorkflowTables = isMissingWorkflowTablesError(error);

    if (!isMissingWorkflowTables) {
      throw error;
    }

    await processLegacyRequisitionApprovalAction({
      requisitionId: validated.requisitionId,
      actorUserId,
      action: validated.action,
      actorPermission: user?.permissions?.Requisition,
    });
  }

  if (validated.comment) {
    await prisma.request_comments.create({
      data: {
        request_id: validated.requisitionId,
        comment: validated.comment,
        user_id: actorUserId,
      },
    });

    await notifyRequisitionCommentParticipants({
      requisitionId: validated.requisitionId,
      actorUserId,
      comment: validated.comment,
    });
  }

  return getRequisition(validated.requisitionId, user);
};

export const getStaffRequisition = async (user: any) => {
  return getRequisitionSummaryFromRequests({
    request_approval_status: {
      not: RequestApprovalStatus.Draft,
    },
  });
};

export const getRequisition = async (id: any, user: any) => {
  const actorUserId = getAuthenticatedUserId(user);

  if (id) {
    const buildInclude = (includeApprovalInstances: boolean) => ({
      request_comments: {
        include: { request_comment_user: { select: { name: true } } },
      },
      attachmentsList: true,
      products: {
        select: {
          id: true,
          name: true,
          unitPrice: true,
          quantity: true,
          image_url: true,
        },
      },
      request_approvals: {
        select: {
          hod_sign: true,
          ps_sign: true,
        },
      },
      department: { select: { id: true, name: true } },
      event: {
        select: {
          id: true,
          event: {
            select: {
              event_name: true,
            },
          },
        },
      },
      ...(includeApprovalInstances && {
        approval_instances: {
          orderBy: {
            step_order: "asc" as const,
          },
        },
      }),
      user: {
        select: {
          name: true,
          email: true,
          position: { select: { name: true } },
        },
      },
    });

    let response;
    try {
      response = await prisma.request.findUnique({
        where: {
          id: parseInt(id),
        },
        include: buildInclude(true),
      });
    } catch (error) {
      if (!isMissingWorkflowTablesError(error)) {
        throw error;
      }

      response = await prisma.request.findUnique({
        where: {
          id: parseInt(id),
        },
        include: buildInclude(false),
      });
    }

    if (!response) {
      throw new NotFoundError("Requisition not found");
    }

    if (
      actorUserId !== response.user_id &&
      !hasRequisitionManagePermission(user)
    ) {
      throw new UnauthorizedError(
        "You do not have permission to access this requisition",
      );
    }

    const editMetadataMap = await getRequisitionEditMetadataMap([response.id]);
    const editMetadata = editMetadataMap.get(response.id) || null;

    if (response.approval_instances?.length) {
      const approverUserIds = Array.from(
        new Set(
          response.approval_instances
            .flatMap((instance) => [instance.approver_user_id, instance.acted_by_user_id])
            .filter((userId): userId is number => typeof userId === "number"),
        ),
      );

      if (approverUserIds.length) {
        const approvalUsers = await prisma.user.findMany({
          where: {
            id: {
              in: approverUserIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        });

        const approvalUserMap = new Map(
          approvalUsers.map((approvalUser) => [approvalUser.id, approvalUser.name]),
        );

        response.approval_instances = response.approval_instances.map((instance) => ({
          ...instance,
          approver_name: approvalUserMap.get(instance.approver_user_id) || null,
          acted_by_name: instance.acted_by_user_id
            ? approvalUserMap.get(instance.acted_by_user_id) || null
            : null,
        }));
      }
    }

    // Calculate total_cost
    const totalCost = calculateTotalCost(response.products);

    // Transform the response into the desired shape
    return updateRequestReturnValue(response, totalCost, editMetadata);
  } else {
    throw new InputValidationError("Requisition ID is required");
  }
};
