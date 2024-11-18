import { prisma } from "../../Models/context";
import {
  RequisitionInterface,
  RequestApprovals,
} from "../../interfaces/requisitions-interface";

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
      user_id: data.user_id,
      department_id: data.department_id,
      event_id: data.event_id,
      requisition_date: new Date(data.request_date),
      comment: data.comment,
      request_approval_status: data.approval_status,
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

export const listRequisition = async () => {
  const response = await prisma.requisition_summary.findMany({
    orderBy: {
      requisition_id: "desc",
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
      products: true,
      attachmentsList: true,
      request_approvals: true,
      user: true,
    },
  });
  return response;
};
