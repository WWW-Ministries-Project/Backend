import { RequestApprovalStatus, requested_item } from "@prisma/client";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";
import { UnauthorizedError } from "../../utils/custom-error-handlers";

export const mapProducts = (products: RequisitionInterface["products"]) =>
  products?.map((product) => ({
    where: { id: product.id },
    update: {
      name: product.name,
      unitPrice: product.unitPrice,
      quantity: product.quantity,
    },
    create: {
      name: product.name,
      unitPrice: product.unitPrice,
      quantity: product.quantity,
    },
  }));

export const mapAttachments = (
  attachments: RequisitionInterface["attachmentLists"]
) =>
  attachments?.map((attachment) => ({
    where: { id: attachment.id },
    update: {
      URL: attachment.URL,
    },
    create: {
      URL: attachment.URL,
    },
  }));

export const calculateTotalCost = (
  products: requested_item[] | undefined
): number =>
  products?.reduce(
    (sum, product) => sum + product.unitPrice * product.quantity,
    0
  ) || 0;

export const checkPermissions = (user: any, requisitionUserId: number) => {
  const isHOD = user.permissions.Requisition === "Can_Manage";
  const isPastor = user.permissions.Requisition === "Super_Admin";
  const isMember = !isHOD && !isPastor;

  if (isMember && requisitionUserId !== user.id) {
    throw new UnauthorizedError(
      "You do not have permission to access this requisition"
    );
  }

  return { isHOD, isPastor, isMember };
};

export const updateDataPayload = (
  data: any,
  { isMember }: any,
  requestApprovalStatus: any,
  attachmentsToUpdate: any,
  newAttachments: any
) => {
  return {
    user_id: data.user_id,
    user_sign: isMember ? data.user_sign : undefined,
    department_id: data.department_id,
    event_id: data.event_id,
    requisition_date: data.request_date
      ? new Date(data.request_date)
      : undefined,
    request_approval_status: requestApprovalStatus,
    currency: data.currency,
    products: data.products
      ? { upsert: mapProducts(data.products) }
      : undefined,
    attachmentsList: {
      upsert: mapAttachments(attachmentsToUpdate),
      create: newAttachments.map((attachment: any) => ({
        URL: attachment.URL,
      })),
    },
  };
};

export const updateRequestReturnValue = (
  updatedRequest: any,
  totalCost: any
) => {
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
    request_comments: updatedRequest.request_comments || null,
    currency: updatedRequest.currency || null,
    products: updatedRequest.products || [],
    attachmentLists: updatedRequest.attachmentsList || [],
  };
};

export const getApprovalData = (
  data: { user_sign?: string; approval_status?: RequestApprovalStatus },
  token_user_id: number,
  isHOD: boolean,
  isPastor: boolean,
  isMember: boolean
) => {
  let requestApprovalStatus;
  const approvalData: any = {};

  if (isMember) {
    requestApprovalStatus = data.user_sign
      ? RequestApprovalStatus.Awaiting_HOD_Approval
      : data.approval_status;
  } else if (isHOD) {
    requestApprovalStatus = data.user_sign
      ? RequestApprovalStatus.Awaiting_Executive_Pastor_Approval
      : data.approval_status;
    approvalData.hod_user_id = data.user_sign ? token_user_id : undefined;
    approvalData.hod_approved = !!data.user_sign;
    approvalData.hod_approval_date = data.user_sign ? new Date() : undefined;
    approvalData.hod_sign = data.user_sign ?? undefined;
  } else if (isPastor) {
    requestApprovalStatus = data.user_sign
      ? RequestApprovalStatus.APPROVED
      : data.approval_status;
    approvalData.ps_user_id = data.user_sign ? token_user_id : undefined;
    approvalData.ps_approved = !!data.user_sign;
    approvalData.ps_approval_date = data.user_sign ? new Date() : undefined;
    approvalData.ps_sign = data.user_sign ?? undefined;
  }

  return { requestApprovalStatus, approvalData };
};