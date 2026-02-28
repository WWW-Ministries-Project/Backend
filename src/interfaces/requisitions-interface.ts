import { RequestApprovalStatus } from "@prisma/client";

// Interface for individual product items
export interface RequestedItem {
  id?: number;
  name: string;
  unitPrice: number;
  quantity: number;
  image_url?: string | null;
}

// Interface for individual attachments
export interface RequestAttachment {
  id?: number;
  URL: string;
}

// Main interface for requisition
export interface RequisitionInterface {
  id?: number;
  requester_name?: string;
  comment?: string;
  comment_id?: number;
  request_date?: string;
  department_id: number;
  event_id?: number | null;
  currency: string;
  approval_status?: RequestApprovalStatus;
  user_id: number;
  products: RequestedItem[];
  attachmentLists?: RequestAttachment[];
  user_sign?: string;
  hod_sign?: string;
  ps_sign?: string;
  fnc_sign?: string;
}

export interface RequestApprovals {
  id: number;
  user_sign: string;

  request_id: number | null;
  hod_user_id: number | null;
  hod_approved: boolean;
  hod_approval_date: Date | null;
  hod_comment: string | null;
  ps_user_id: number | null;
  ps_approved: boolean;
  ps_approval_date?: Date | null;
  ps_comment: string | null;
}

export type RequisitionApprovalModuleType = "REQUISITION";
export type RequisitionApproverTypeValue =
  | "HEAD_OF_DEPARTMENT"
  | "POSITION"
  | "SPECIFIC_PERSON";

export interface RequisitionApprovalConfigApprover {
  order: number;
  type: RequisitionApproverTypeValue;
  position_id?: number;
  user_id?: number;
}

export interface RequisitionApprovalConfigPayload {
  module: RequisitionApprovalModuleType;
  requester_user_ids: number[];
  approvers: RequisitionApprovalConfigApprover[];
  is_active?: boolean;
}

export interface RequisitionApprovalActionPayload {
  requisition_id: number;
  action: "APPROVE" | "REJECT";
  comment?: string;
}
