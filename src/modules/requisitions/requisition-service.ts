import Joi from "joi";
import { prisma } from "../../Models/context";
import {
  RequisitionInterface,
  RequestApprovals,
} from "../../interfaces/requisitions-interface";
import {
  mapProducts,
  mapAttachments,
  calculateTotalCost,
} from "./requsition-helpers";
import { RequestApprovalStatus } from "@prisma/client";

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
      comment: data.comment,
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
    },
  });

  return createdRequest;
};

/**
 * Updates an existing requisition by its ID.
 * @param {Partial<RequisitionInterface>} data The data to update the requisition with.
 * @returns {Promise<RequisitionInterface>} The updated requisition, including all its products and attachments.
 */
/**
 * @typedef {Object} RequisitionSummary
 
 */
export const updateRequisition = async (
  data: Partial<RequisitionInterface>
) => {
  if (!data.id) {
    throw new Error("Requisition ID is required for updates.");
  }

  // Fetch existing attachments for the requisition
  const existingAttachments = await prisma.request_attachment.findMany({
    where: { request_id: data.id },
    select: { id: true },
  });

  const incomingAttachments = data.attachmentLists || [];
  const newAttachments = incomingAttachments.filter(
    (attachment) => !attachment.hasOwnProperty("id")
  );
  const attachmentsToUpdate = incomingAttachments.filter((attachment) =>
    existingAttachments.some((ea) => ea.id === attachment.id)
  );
  const attachmentsToDelete = existingAttachments.filter(
    (ea) => !incomingAttachments.some((ia) => ia.id === ea.id)
  );

  // Build the update payload
  const updateData: any = {
    user_id: data.user_id,
    user_sign: data.user_sign,
    department_id: data.department_id,
    event_id: data.event_id,
    requisition_date: data.request_date
      ? new Date(data.request_date)
      : undefined,
    comment: data.comment,
    request_approval_status: data.user_sign
      ? RequestApprovalStatus.Awaiting_HOD_Approval
      : data.approval_status,
    currency: data.currency,
    products: data.products
      ? { upsert: mapProducts(data.products) }
      : undefined,
    attachmentsList: {
      upsert: mapAttachments(attachmentsToUpdate),
      create: newAttachments.map((attachment) => ({
        URL: attachment.URL,
      })),
    },
  };

  // Update the requisition
  const updatedRequest = await prisma.request.update({
    where: { id: data.id },
    data: updateData,
    include: {
      products: true,
      attachmentsList: true,
      department: true,
      event: true,
      request_approvals: true,
      user: { include: { position: true } },
    },
  });

  // Delete omitted attachments
  await prisma.request_attachment.deleteMany({
    where: { id: { in: attachmentsToDelete.map((a) => a.id) } },
  });

  // Calculate total cost
  const totalCost = calculateTotalCost(updatedRequest.products);

  return {
    summary: {
      requisition_id: updatedRequest.id,
      user_sign: updatedRequest.user_sign,
      department: updatedRequest.department?.name || null,
      program: updatedRequest.event?.name || null,
      request_date: updatedRequest.requisition_date,
      total_cost: totalCost,
      status: updatedRequest.request_approval_status,
    },
    requester: {
      name: updatedRequest.user?.name || null,
      email: updatedRequest.user?.email || null,
      position: updatedRequest.user?.position?.name || null,
    },
    request_approvals: updatedRequest.request_approvals,
    comment: updatedRequest.comment || null,
    currency: updatedRequest.currency || null,
    products: updatedRequest.products || [],
    attachmentLists: updatedRequest.attachmentsList || [],
  };
};

// Helper functions remain the same

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
      throw new Error(`Requisition with ID ${id} not found.`);
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

    return {
      message:
        "Requisition and its related products and attachments have been deleted.",
    };
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

export const SignDraftRequisitionDocument = async (data: RequestApprovals) => {
  const { user_sign, request_id } = data;

  const findRequest = await prisma.request.findUnique({
    where: {
      id: Number(request_id),
    },
  });

  if (!findRequest) {
    throw new Error("Request not found");
  }

  const response = await prisma.request.update({
    where: {
      id: Number(request_id),
    },
    data: {
      user_sign: user_sign,
      request_approval_status: user_sign
        ? RequestApprovalStatus.Awaiting_HOD_Approval
        : findRequest?.request_approval_status,
    },
  });
  return response;
};

export const HODapproveRequisition = async (
  data: RequestApprovals
): Promise<{}> => {
  await prisma.request_approvals.update({
    where: {
      request_id: Number(data.request_id),
    },
    data: {
      hod_user_id: data.hod_user_id,
      hod_approval_date: new Date(),
      hod_approved: data.hod_approved,
      hod_comment: data.hod_comment,
    },
  });

  const response = await prisma.request.update({
    where: {
      id: Number(data.request_id),
    },
    data: {
      request_approval_status: data.hod_approved
        ? "Awaiting_Executive_Pastor_Approval"
        : "REJECTED",
    },
  });
  return response;
};

export const PSapproveRequisition = async (
  data: RequestApprovals
): Promise<{}> => {
  await prisma.request_approvals.update({
    where: {
      request_id: Number(data.request_id),
    },
    data: {
      ps_user_id: data.ps_user_id,
      ps_approval_date: new Date(),
      ps_approved: data.ps_approved,
      ps_comment: data.ps_comment,
    },
  });

  const response = await prisma.request.update({
    where: {
      id: Number(data.request_id),
    },
    data: {
      request_approval_status: data.ps_approved ? "APPROVED" : "REJECTED",
    },
  });

  return response;
};

export const getRequisition = async (id: any) => {
  const response = await prisma.request.findUnique({
    where: {
      id: parseInt(id),
    },
    include: {
      attachmentsList: true,
      products: true,
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      event: {
        select: {
          id: true,
          name: true,
        },
      },
      request_approvals: true,
      user: {
        select: {
          name: true,
          email: true,
          position: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!response) {
    return null; // Handle case where no requisition is found
  }

  // Calculate total_cost
  const totalCost =
    response.products?.reduce((sum, product) => {
      return sum + product.unitPrice * product.quantity;
    }, 0) || 0;

  // Transform the response into the desired shape
  const structuredResponse = {
    summary: {
      requisition_id: response.request_id,
      department: response.department?.name || null,
      program: response.event?.name || null,
      request_date: response.requisition_date,
      total_cost: totalCost,
      status: response.request_approval_status,
      event_id: response.event?.id || null,
      department_id: response.department?.id || null,
    },
    requester: {
      name: response.user?.name || null,
      email: response.user?.email || null,
      user_sign: response.user_sign || null,
      position: response.user?.position?.name || null,
    },
    request_approvals: response.request_approvals,
    comment: response.comment || null,
    currency: response.currency || null,
    products: response.products || [],
    attachmentLists: response.attachmentsList || [],
  };

  return structuredResponse;
};
