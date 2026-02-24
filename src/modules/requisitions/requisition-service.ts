import Joi from "joi";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../../Models/context";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";
import {
  calculateTotalCost,
  checkPermissions,
  getApprovalData,
  updateDataPayload,
  updateRequestReturnValue,
} from "./requsition-helpers";
import { RequestApprovalStatus } from "@prisma/client";
import { cloudinary } from "../../utils";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

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

const resolveCreateApprovalState = async (data: RequisitionInterface) => {
  const isRequesterSigned = Boolean(data.user_sign?.trim());
  const fallbackStatus = isRequesterSigned
    ? RequestApprovalStatus.Awaiting_HOD_Approval
    : RequestApprovalStatus.Draft;
  const baseStatus = data.approval_status || fallbackStatus;

  const department = await prisma.department.findUnique({
    where: { id: data.department_id },
    select: { department_head: true },
  });

  const isRequesterHOD = department?.department_head === data.user_id;
  const shouldAutoApproveByHOD =
    isRequesterHOD && isRequesterSigned;

  const requestApprovalStatus = shouldAutoApproveByHOD
    ? RequestApprovalStatus.Awaiting_Executive_Pastor_Approval
    : baseStatus;

  return {
    requestApprovalStatus,
    approvalData: {
      hod_user_id: shouldAutoApproveByHOD ? data.user_id : null,
      hod_approved: shouldAutoApproveByHOD,
      hod_approval_date: shouldAutoApproveByHOD ? new Date() : null,
      hod_sign: shouldAutoApproveByHOD ? data.user_sign || null : null,
      ps_user_id: null,
      ps_approval_date: null,
    },
  };
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
  const { requestApprovalStatus, approvalData } =
    await resolveCreateApprovalState(data);

  const createdRequest = await prisma.request.create({
    data: {
      request_id: requestId,
      user_sign: data.user_sign,
      user_id: data.user_id,
      department_id: data.department_id,
      event_id: data.event_id,
      requisition_date: new Date(data.request_date),
      request_approval_status: requestApprovalStatus,
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
        create: approvalData,
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
    include: {
      products: true,
      attachmentsList: true,
      request_comments: true,
    },
  });

  if (data.comment) {
    await prisma.request_comments.create({
      data: {
        request_id: createdRequest.id,
        comment: data.comment,
        user_id: createdRequest.user_id,
      },
    });
  }

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

  const [findRequest, existingApproval, existingAttachments, existingProducts] =
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

  if (!findRequest) {
    throw new NotFoundError("Requisition not found");
  }
  // check if logged user has permission to update the requisition
  const { isHOD, isPastor, isMember } = checkPermissions(
    user,
    findRequest.user_id,
  );

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

  // Build the update payload
  const updateData = updateDataPayload(
    data,
    isMember,
    requestApprovalStatus,
    productsToUpdate,
    newProducts,
    attachmentsToUpdate,
    newAttachments,
  );

  if (existingApproval) {
    await prisma.request_approvals.update({
      where: { request_id: data.id },
      data: {
        ...approvalData,
      },
    });
  } else {
    await prisma.request_approvals.create({
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
      await prisma.request_comments.update({
        where: { id: data.comment_id },
        data: { comment: data.comment },
      });
    } else {
      // Create new comment
      await prisma.request_comments.create({ data: commentData });
    }
  }

  // Update the requisition
  await prisma.request.update({
    where: { id: data.id },
    data: updateData,
  });

  // Delete omitted requested items
  if (productsToDelete.length) {
    await prisma.requested_item.deleteMany({
      where: { id: { in: productsToDelete.map((product) => product.id) } },
    });
  }

  // Delete omitted attachments
  if (attachmentsToDelete.length) {
    await prisma.request_attachment.deleteMany({
      where: { id: { in: attachmentsToDelete.map((attachment) => attachment.id) } },
    });
  }

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
  const response = await prisma.requisition_summary.findMany({
    orderBy: {
      requisition_id: "desc",
    },
  });
  return response;
};

export const getmyRequisition = async (id: any) => {
  const response = await prisma.requisition_summary.findMany({
    where: {
      user_id: parseInt(id),
    },
    orderBy: {
      requisition_id: "desc",
    },
  });
  return response;
};

export const getStaffRequisition = async (user: any) => {
  const { id, permissions } = user;

  // Determine User Role
  const isHOD = permissions.Requisition === "Can_Manage";
  const isPastor = permissions.Requisition === "Super_Admin";

  let requisitions;

  if (isHOD) {
    const findDepartment = await prisma.user_departments.findUnique({
      where: {
        user_id: id,
      },
      include: {
        department_info: true,
      },
    });

    requisitions = await prisma.requisition_summary.findMany({
      where: {
        AND: [
          {
            department_id: findDepartment?.department_id as any,
            approval_status: {
              in: ["Awaiting_HOD_Approval", "APPROVED", "REJECTED"],
            },
          },
        ],
      },
    });
  }

  if (isPastor) {
    requisitions = await prisma.requisition_summary.findMany({
      where: {
        approval_status: {
          in: ["Awaiting_Executive_Pastor_Approval", "APPROVED", "REJECTED"],
        },
      },
    });
  }

  return requisitions || [];
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
