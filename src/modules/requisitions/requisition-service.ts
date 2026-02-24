import Joi from "joi";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../../Models/context";
import {
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
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
} from "@prisma/client";
import { cloudinary } from "../../utils";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import {
  buildRequisitionApprovalSnapshotTx,
  getRequisitionApprovalConfig,
  processRequisitionApprovalAction,
  upsertRequisitionApprovalConfig,
  validateApprovalActionPayload,
} from "./requisition-approval-workflow";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

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
  products: { name: string; unitPrice: number; quantity: number }[];
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
});

const getRequisitionSummaryFromRequests = async (where?: any) => {
  const requests = await prisma.request.findMany({
    where,
    include: {
      products: {
        select: {
          name: true,
          unitPrice: true,
          quantity: true,
        },
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return requests.map(mapRequestToSummary);
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
export const createRequisition = async (data: RequisitionInterface) => {
  if (!data.request_date) {
    throw new InputValidationError("Request date is required.");
  }

  const requestId = await generateRequestId();
  const shouldSubmit = Boolean(data.user_sign?.trim());

  const createdRequest = await prisma.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: {
        request_id: requestId,
        user_sign: data.user_sign,
        user_id: data.user_id,
        department_id: data.department_id,
        event_id: data.event_id,
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
      },
      select: {
        id: true,
        user_id: true,
        department_id: true,
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
      await buildRequisitionApprovalSnapshotTx(tx, {
        requestId: request.id,
        requesterId: request.user_id,
        fallbackDepartmentId: request.department_id,
      });
    }

    return request;
  });

  return getRequisition(createdRequest.id);
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

  const { id: token_user_id } = user;

  const [
    findRequest,
    existingApproval,
    existingAttachments,
    existingProducts,
    existingApprovalInstance,
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
      prisma.requisition_approval_instances.findFirst({
        where: { request_id: data.id },
        select: { id: true },
      }),
    ]);

  if (!findRequest) {
    throw new NotFoundError("Requisition not found");
  }
  // check if logged user has permission to update the requisition
  const { isHOD, isPastor, isMember } = checkPermissions(
    user,
    findRequest.user_id,
  );

  const hasApprovalWorkflow = Boolean(existingApprovalInstance);
  const isSignedAction = Boolean(data.user_sign?.trim());

  if (hasApprovalWorkflow && !isMember && isSignedAction) {
    const action =
      data.approval_status === RequestApprovalStatus.REJECTED
        ? "REJECT"
        : "APPROVE";

    await processRequisitionApprovalAction({
      requisitionId: data.id,
      actorUserId: token_user_id,
      action,
      ...(data.comment && { comment: data.comment }),
    });

    if (data.comment) {
      await prisma.request_comments.create({
        data: {
          request_id: data.id,
          comment: data.comment,
          user_id: token_user_id,
        },
      });
    }

    return getRequisition(data.id);
  }

  const incomingAttachments = data.attachmentLists || [];
  const incomingProducts = data.products || [];

  const newAttachments = incomingAttachments.filter(
    (attachment) => typeof attachment.id !== "number",
  );
  const attachmentsToUpdate = incomingAttachments.filter((attachment) =>
    typeof attachment.id === "number" &&
    existingAttachments.some((ea) => ea.id === attachment.id),
  );
  const attachmentsToDelete = data.attachmentLists
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
  const productsToDelete = data.products
    ? existingProducts.filter(
        (existingProduct) =>
          !incomingProducts.some((incomingProduct) => incomingProduct.id === existingProduct.id),
      )
    : [];

  const { requestApprovalStatus, approvalData } = getApprovalData(
    data,
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
  const effectiveRequestApprovalStatus = shouldSubmitByRequester
    ? findRequest.request_approval_status
    : requestApprovalStatus;

  // Build the update payload
  const updateData = updateDataPayload(
    data,
    isMember,
    effectiveRequestApprovalStatus,
    productsToUpdate,
    newProducts,
    attachmentsToUpdate,
    newAttachments,
  );

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

    if (data.comment) {
      const commentData = {
        request_id: data.id,
        comment: data.comment,
        user_id: token_user_id,
      };

      if (data.comment_id) {
        // Update existing comment
        await tx.request_comments.update({
          where: { id: data.comment_id },
          data: { comment: data.comment },
        });
      } else {
        // Create new comment
        await tx.request_comments.create({ data: commentData });
      }
    }

    // Update the requisition
    await tx.request.update({
      where: { id: data.id },
      data: updateData,
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
      await buildRequisitionApprovalSnapshotTx(tx, {
        requestId: data.id as number,
        requesterId: findRequest.user_id,
        fallbackDepartmentId: findRequest.department_id,
      });
    }
  });

  // Return the latest record shape after deletions.
  return getRequisition(data.id);
};

/**
 * Deletes a requisition and its related products and attachments.
 * @param {any} id The ID of the requisition to delete.
 * @returns {Promise<{message: string}>} A promise containing a message indicating the success of the deletion.
 */
export const deleteRequisition = async (id: any) => {
  await Joi.object({
    id: Joi.required(),
  }).validateAsync({ id });

  const parsedId = parseInt(id);
  const requisition = await prisma.request.findUnique({
    where: { id: parsedId },
    include: {
      products: true,
      attachmentsList: true,
    },
  });

  if (!requisition) {
    throw new NotFoundError(`Requisition with ID ${id} not found.`);
  }

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

export const listRequisition = async () => {
  return getRequisitionSummaryFromRequests();
};

export const getmyRequisition = async (id: any) => {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new InputValidationError("A valid user ID is required");
  }

  return getRequisitionSummaryFromRequests({
    user_id: userId,
  });
};

export const saveRequisitionApprovalConfig = async (
  payload: RequisitionApprovalConfigPayload,
  actorUserId?: number,
) => {
  return upsertRequisitionApprovalConfig(payload, actorUserId);
};

export const fetchRequisitionApprovalConfig = async () => {
  return getRequisitionApprovalConfig();
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

  await prisma.$transaction(async (tx) => {
    const requisition = await tx.request.findUnique({
      where: {
        id: parsedId,
      },
      select: {
        id: true,
        user_id: true,
        department_id: true,
      },
    });

    if (!requisition) {
      throw new NotFoundError("Requisition not found");
    }

    if (requisition.user_id !== requesterId) {
      throw new UnauthorizedError("Only the requester can submit this requisition");
    }

    await buildRequisitionApprovalSnapshotTx(tx, {
      requestId: requisition.id,
      requesterId: requisition.user_id,
      fallbackDepartmentId: requisition.department_id,
    });
  });

  return getRequisition(parsedId);
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

  await processRequisitionApprovalAction({
    requisitionId: validated.requisitionId,
    actorUserId,
    action: validated.action,
    comment: validated.comment,
  });

  if (validated.comment) {
    await prisma.request_comments.create({
      data: {
        request_id: validated.requisitionId,
        comment: validated.comment,
        user_id: actorUserId,
      },
    });
  }

  return getRequisition(validated.requisitionId);
};

export const getStaffRequisition = async (user: any) => {
  const { id, permissions } = user;

  // Determine User Role
  const isHOD = permissions.Requisition === "Can_Manage";
  const isPastor = permissions.Requisition === "Super_Admin";

  if (!isHOD && !isPastor) {
    return [];
  }

  return getRequisitionSummaryFromRequests({
    OR: [
      {
        approval_instances: {
          some: {
            approver_user_id: id,
            status: RequisitionApprovalInstanceStatus.PENDING,
          },
        },
      },
      {
        request_approval_status: {
          in: [RequestApprovalStatus.APPROVED, RequestApprovalStatus.REJECTED],
        },
      },
    ],
  });
};

export const getRequisition = async (id: any) => {
  if (id) {
    const response = await prisma.request.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        request_comments: {
          include: { request_comment_user: { select: { name: true } } },
        },
        attachmentsList: true,
        products: true,
        department: { select: { id: true, name: true } },
        event: { select: { id: true } },
        request_approvals: {
          include: {
            hod_user: {
              select: { name: true, position: { select: { name: true } } },
            },
            ps_user: {
              select: { name: true, position: { select: { name: true } } },
            },
          },
        },
        approval_instances: {
          orderBy: {
            step_order: "asc",
          },
        },
        user: {
          select: {
            name: true,
            email: true,
            position: { select: { name: true } },
          },
        },
      },
    });

    if (!response) {
      throw new NotFoundError("Requisition not found");
    }

    // Calculate total_cost
    const totalCost = calculateTotalCost(response.products);

    // Transform the response into the desired shape
    return updateRequestReturnValue(response, totalCost);
  } else {
    return {};
  }
};
