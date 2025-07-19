import Joi from "joi";
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
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

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
  const requestId = await generateRequestId();

  const createdRequest = await prisma.request.create({
    data: {
      request_id: requestId,
      user_sign: data.user_sign,
      user_id: data.user_id,
      department_id: data.department_id,
      event_id: data.event_id,
      requisition_date: new Date(data.request_date),
      request_approval_status: data.user_sign
        ? RequestApprovalStatus.Awaiting_HOD_Approval
        : data.approval_status,
      currency: data.currency,

      // Create the products related to the request
      products: {
        create: data.products.map((product) => ({
          name: product.name,
          unitPrice: product.unitPrice,
          quantity: product.quantity,
        })),
      },
      request_approvals: {
        create: {
          hod_user_id: null,
          hod_approval_date: null,
          ps_user_id: null,
          ps_approval_date: null,
        },
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
    return await prisma.request_comments.create({
      data: {
        request_id: createdRequest.id,
        comment: data.comment,
        user_id: createdRequest.user_id,
      },
    });
  }

  return createdRequest;
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

  const [findRequest, existingApproval, existingAttachments] =
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
    ]);

  if (!findRequest) {
    throw new NotFoundError("Requisition not found");
  }
  // check if logged user has permission to update the requisition
  const { isHOD, isPastor, isMember } = checkPermissions(
    user,
    findRequest.user_id,
  );

  // Fetch existing attachments for the requisition

  const incomingAttachments = data.attachmentLists || [];
  const newAttachments = incomingAttachments.filter(
    (attachment) => !attachment.hasOwnProperty("id"),
  );
  const attachmentsToUpdate = incomingAttachments.filter((attachment) =>
    existingAttachments.some((ea) => ea.id === attachment.id),
  );
  const attachmentsToDelete = existingAttachments.filter(
    (ea) => !incomingAttachments.some((ia) => ia.id === ea.id),
  );

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
  const updatedRequest = await prisma.request.update({
    where: { id: data.id },
    data: updateData,
    include: {
      products: true,
      attachmentsList: true,
      department: true,
      event: true,
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
      user: { include: { position: true } },
      request_comments: {
        include: {
          request_comment_user: {
            select: { name: true },
          },
        },
      },
    },
  });

  // Delete omitted attachments
  await prisma.request_attachment.deleteMany({
    where: { id: { in: attachmentsToDelete.map((a) => a.id) } },
  });

  // Calculate total cost
  const totalCost = calculateTotalCost(updatedRequest.products);

  return updateRequestReturnValue(updatedRequest, totalCost);
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

  const result = await prisma.$transaction(async (prisma) => {
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

    const deleteProducts = prisma.requested_item.deleteMany({
      where: { request_id: parsedId },
    });

    const deleteAttachments = prisma.request_attachment.deleteMany({
      where: { request_id: parsedId },
    });

    const deleteRequisition = prisma.request.delete({
      where: { id: parsedId },
    });

    await Promise.all([deleteProducts, deleteAttachments, deleteRequisition]);
  });

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
    const totalCost =
      response.products?.reduce((sum, product) => {
        return sum + product.unitPrice * product.quantity;
      }, 0) || 0;

    // Transform the response into the desired shape
    return updateRequestReturnValue(response, totalCost);
  } else {
    return {};
  }
};
