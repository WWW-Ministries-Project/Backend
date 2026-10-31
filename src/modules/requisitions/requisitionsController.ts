import { Request, Response } from "express";
import {
  actionRequisitionApproval,
  createRequisition,
  fetchRequisitionApprovalConfig,
  listRequisition,
  getRequisition,
  saveRequisitionApprovalConfig,
  submitRequisition,
  updateRequisition,
  deleteRequisition,
  getmyRequisition,
  getStaffRequisition,
  getPreApprovalSimilarItems,
} from "./requisition-service";
import {
  addRequisitionComment,
  getRequisitionAnalytics,
  getRequisitionOverview,
  getRequisitionOverviewDetail,
  markRequisitionDisbursed,
  recordRequisitionRevision,
  sendRequisitionReminder,
} from "./requisition-redesign";
import { requisitionUserFrom } from "./requisition-access";
import {
  RequisitionApprovalActionPayload,
  RequisitionApprovalConfigPayload,
  RequisitionInterface,
} from "../../interfaces/requisitions-interface";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

export const createRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;
  const user = requisitionUserFrom(req);

  const createdRequisition = await createRequisition(
    requisitionData as RequisitionInterface,
    user,
  );

  const revisedFromId = Number((requisitionData as any).revised_from_id);
  if (revisedFromId > 0 && (createdRequisition as any)?.id) {
    await recordRequisitionRevision(revisedFromId, {
      id: (createdRequisition as any).id,
      generated_id: (createdRequisition as any).generated_id,
    });
  }

  res.status(201).json({
    message: "Requisition created successfully",
    data: createdRequisition,
  });
};

export const saveRequisitionApprovalConfigHandler = async (
  req: Request,
  res: Response,
) => {
  const payload = req.body as RequisitionApprovalConfigPayload;
  const user = requisitionUserFrom(req);

  const response = await saveRequisitionApprovalConfig(payload, user?.id);
  res.status(200).json({
    message: "Saved successfully",
    data: response,
  });
};

export const getRequisitionApprovalConfigHandler = async (
  req: Request,
  res: Response,
) => {
  const response = await fetchRequisitionApprovalConfig();
  res.status(200).json({
    message: "Operation successful",
    data: response,
  });
};

export const updateRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  const user = requisitionUserFrom(req);

  const updatedRequisition = await updateRequisition(
    requisitionData as RequisitionInterface,
    user,
  );
  res.status(201).json({
    message: "Requisition updated successfully",
    data: updatedRequisition,
  });
};

export const submitRequisitionHandler = async (req: Request, res: Response) => {
  const user = requisitionUserFrom(req);
  const requisitionId =
    req.body?.requisition_id || req.body?.id || req.query?.id;
  const response = await submitRequisition(requisitionId, user);

  res.status(200).json({
    message: "Requisition submitted successfully",
    data: response,
  });
};

export const requisitionApprovalActionHandler = async (
  req: Request,
  res: Response,
) => {
  const payload = req.body as RequisitionApprovalActionPayload;
  const user = requisitionUserFrom(req);

  const response = await actionRequisitionApproval(payload, user);
  res.status(200).json({
    message: "Operation successful",
    data: response,
  });
};

export const preApprovalSimilarItemsHandler = async (
  req: Request,
  res: Response,
) => {
  const requisitionId = req.query?.requisition_id;
  const days = req.query?.days;

  const response = await getPreApprovalSimilarItems(
    requisitionId,
    days,
    requisitionUserFrom(req),
  );
  res.status(200).json({
    message: "Operation successful",
    data: response,
  });
};

export const listRequisitionHandler = async (req: Request, res: Response) => {
  const user = requisitionUserFrom(req);
  const requisitions = await listRequisition(user, req.query?.branch_id);
  res.status(200).json({
    message: "Requisitions retrieved successfully",
    data: requisitions,
  });
};

export const userRequisitionsHandler = async (req: Request, res: Response) => {
  const user = requisitionUserFrom(req);
  const response = await getmyRequisition(user, req.query?.branch_id);
  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};

export const getRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;
  const user = requisitionUserFrom(req);

  const response = await getRequisition(id, user);
  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};

export const staffRequestHandler = async (req: Request, res: Response) => {
  const user = requisitionUserFrom(req);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const response = await getStaffRequisition(user, req.query?.branch_id);

  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};
export const deleteRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;
  const user = requisitionUserFrom(req);

  if (!id) {
    throw new InputValidationError("Requisition ID is required");
  }
  await deleteRequisition(id, user);
  res.status(201).json({
    message: "Operation successful",
  });
};

export const requisitionOverviewHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionOverview(requisitionUserFrom(req), {
    scope: req.query.scope,
    branch_id: req.query.branch_id,
  });
  res.status(200).json({ message: "Operation successful", data });
};

export const requisitionOverviewDetailHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionOverviewDetail(req.query.id, requisitionUserFrom(req));
  res.status(200).json({ message: "Operation successful", data });
};

export const sendRequisitionReminderHandler = async (req: Request, res: Response) => {
  const data = await sendRequisitionReminder(req.body, requisitionUserFrom(req));
  res.status(200).json({ message: "Reminder sent", data });
};

export const requisitionAnalyticsHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionAnalytics(requisitionUserFrom(req), {
    from: req.query.from,
    to: req.query.to,
    bucket: req.query.bucket,
    department_id: req.query.department_id,
    branch_id: req.query.branch_id,
  });
  res.status(200).json({ message: "Operation successful", data });
};

export const addRequisitionCommentHandler = async (req: Request, res: Response) => {
  const data = await addRequisitionComment(req.body, requisitionUserFrom(req));
  res.status(201).json({ message: "Comment added", data });
};

export const markRequisitionDisbursedHandler = async (req: Request, res: Response) => {
  const data = await markRequisitionDisbursed(req.body, requisitionUserFrom(req));
  res.status(200).json({ message: "Requisition marked disbursed", data });
};
