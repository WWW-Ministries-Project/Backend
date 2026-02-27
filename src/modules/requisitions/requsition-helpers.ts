import { RequestApprovalStatus } from "@prisma/client";
import {
  RequestAttachment,
  RequisitionInterface,
  RequestedItem,
} from "../../interfaces/requisitions-interface";
import { UnauthorizedError } from "../../utils/custom-error-handlers";

export const mapProducts = (products: RequestedItem[] = []) =>
  products
    .filter(
      (product): product is RequestedItem & { id: number } =>
        typeof product.id === "number",
    )
    .map((product) => ({
      where: { id: product.id },
      update: {
        name: product.name,
        unitPrice: product.unitPrice,
        quantity: product.quantity,
        image_url: product.image_url,
      },
      create: {
        name: product.name,
        unitPrice: product.unitPrice,
        quantity: product.quantity,
        image_url: product.image_url,
      },
    }));

export const mapAttachments = (
  attachments: RequestAttachment[] = [],
) =>
  attachments
    .filter(
      (attachment): attachment is RequestAttachment & { id: number } =>
        typeof attachment.id === "number",
    )
    .map((attachment) => ({
      where: { id: attachment.id },
      update: {
        URL: attachment.URL,
      },
      create: {
        URL: attachment.URL,
      },
    }));

export const calculateTotalCost = (
  products: Array<{ unitPrice: number; quantity: number }> | undefined,
): number =>
  products?.reduce(
    (sum, product) => sum + product.unitPrice * product.quantity,
    0,
  ) || 0;

export const checkPermissions = (user: any, requisitionUserId: number) => {
  const rawPermissions = user?.permissions;
  const permissions =
    typeof rawPermissions === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(rawPermissions);
            return parsed && typeof parsed === "object" ? parsed : {};
          } catch (error) {
            return {};
          }
        })()
      : rawPermissions && typeof rawPermissions === "object"
        ? rawPermissions
        : {};

  const requisitionPermission = String(permissions?.Requisition || "");
  const isHOD = requisitionPermission === "Can_Manage";
  const isPastor = requisitionPermission === "Super_Admin";
  const isMember = !isHOD && !isPastor;

  if (isMember && requisitionUserId !== user?.id) {
    throw new UnauthorizedError(
      "You do not have permission to access this requisition",
    );
  }

  return { isHOD, isPastor, isMember };
};

export const updateDataPayload = (
  data: Partial<RequisitionInterface>,
  isMember: boolean,
  requestApprovalStatus: RequestApprovalStatus | undefined,
  productsToUpdate: RequestedItem[],
  newProducts: RequestedItem[],
  attachmentsToUpdate: RequestAttachment[],
  newAttachments: RequestAttachment[],
) => {
  const productUpsert = mapProducts(productsToUpdate);
  const attachmentUpsert = mapAttachments(attachmentsToUpdate);
  const productCreate = newProducts.map((product) => ({
    name: product.name,
    unitPrice: product.unitPrice,
    quantity: product.quantity,
    image_url: product.image_url,
  }));
  const attachmentCreate = newAttachments.map((attachment) => ({
    URL: attachment.URL,
  }));

  const productsPayload = data.products
    ? {
        ...(productUpsert.length ? { upsert: productUpsert } : {}),
        ...(productCreate.length ? { create: productCreate } : {}),
      }
    : undefined;

  const attachmentsPayload = data.attachmentLists
    ? {
        ...(attachmentUpsert.length ? { upsert: attachmentUpsert } : {}),
        ...(attachmentCreate.length ? { create: attachmentCreate } : {}),
      }
    : undefined;

  const hasProductsPayload =
    !!productsPayload && Object.keys(productsPayload).length > 0;
  const hasAttachmentsPayload =
    !!attachmentsPayload && Object.keys(attachmentsPayload).length > 0;

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
    products: hasProductsPayload ? productsPayload : undefined,
    attachmentsList: hasAttachmentsPayload ? attachmentsPayload : undefined,
  };
};

export const updateRequestReturnValue = (
  updatedRequest: any,
  totalCost: any,
) => {
  const eventName = updatedRequest.event?.event?.event_name || null;
  const approvalInstances = updatedRequest.approval_instances || [];
  const actedInstances = approvalInstances.filter(
    (instance: any) => instance.acted_at,
  );
  const latestActedInstance = actedInstances.length
    ? actedInstances.sort(
        (a: any, b: any) =>
          new Date(b.acted_at).getTime() - new Date(a.acted_at).getTime(),
      )[0]
    : null;
  const currentPendingInstance =
    approvalInstances.find((instance: any) => instance.status === "PENDING") || null;
  const selectedApproverInstance =
    latestActedInstance || currentPendingInstance || approvalInstances[0] || null;

  return {
    id: updatedRequest.id,
    generated_id: updatedRequest.request_id || null,
    requester_name: updatedRequest.user?.name || null,
    department_id:
      updatedRequest.department_id ?? updatedRequest.department?.id ?? null,
    event_id: updatedRequest.event_id ?? updatedRequest.event?.id ?? null,
    event_name: eventName,
    request_date: updatedRequest.requisition_date || null,
    approval_status: updatedRequest.request_approval_status || null,
    approver_name:
      selectedApproverInstance?.acted_by_name ||
      selectedApproverInstance?.approver_name ||
      null,
    user_id: updatedRequest.user_id ?? null,
    user_sign: updatedRequest.user_sign || null,
    comment:
      updatedRequest.request_comments?.[
        updatedRequest.request_comments.length - 1
      ]?.comment || null,
    summary: {
      requisition_id: updatedRequest.id,
      user_sign: updatedRequest.user_sign,
      department: updatedRequest.department?.name || null,
      department_id: updatedRequest.department?.id || null,
      program: eventName,
      program_id: updatedRequest.event?.id || null,
      request_date: updatedRequest.requisition_date,
      total_cost: totalCost,
      status: updatedRequest.request_approval_status,
    },
    requester: {
      name: updatedRequest.user?.name || null,
      email: updatedRequest.user?.email || null,
      position: updatedRequest.user?.position?.name || null,
    },
    approval_instances: approvalInstances,
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
  isMember: boolean,
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
