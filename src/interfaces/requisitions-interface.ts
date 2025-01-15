enum RequestApprovalStatus {
  Draft = "Draft",
  Awaiting_HOD_Approval = "Awaiting_HOD_Approval",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

// Interface for individual product items
export interface RequestedItem {
  id: number;
  name: string;
  unitPrice: number;
  quantity: number;
}

// Interface for individual attachments
export interface RequestAttachment {
  id: number;
  URL: string;
}

// Main interface for requisition
export interface RequisitionInterface {
  id: number;
  requester_name: string;
  comment: string;
  request_date: string;
  department_id: number;
  event_id: number;
  currency: string;
  approval_status: RequestApprovalStatus;
  user_id: number;
  products: RequestedItem[];
  attachmentLists: RequestAttachment[];
  user_sign: string;
  user_comment: string;
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
