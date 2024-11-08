import { prisma } from "../../Models/context";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";

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
      requisition_date: data.request_date,
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
