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
  recordRequisitionRevision,
  sendRequisitionReminder,
} from "./requisition-redesign";
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
  const user = (req as any).user;

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
  const user = (req as any).user;

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

  const user = (req as any).user;

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
  const user = (req as any).user;
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
  const user = (req as any).user;

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

  const response = await getPreApprovalSimilarItems(requisitionId, days);
  res.status(200).json({
    message: "Operation successful",
    data: response,
  });
};

export const listRequisitionHandler = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const requisitions = await listRequisition(user, req.query?.branch_id);
  res.status(200).json({
    message: "Requisitions retrieved successfully",
    data: requisitions,
  });
};

export const userRequisitionsHandler = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const response = await getmyRequisition(user, req.query?.branch_id);
  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};

export const getRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;
  const user = (req as any).user;

  const response = await getRequisition(id, user);
  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};

export const staffRequestHandler = async (req: Request, res: Response) => {
  const user = (req as any).user;

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
  const user = (req as any).user;

  if (!id) {
    throw new InputValidationError("Requisition ID is required");
  }
  await deleteRequisition(id, user);
  res.status(201).json({
    message: "Operation successful",
  });
};

export const requisitionOverviewHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionOverview((req as any).user, {
    scope: req.query.scope,
    branch_id: req.query.branch_id,
  });
  res.status(200).json({ message: "Operation successful", data });
};

export const requisitionOverviewDetailHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionOverviewDetail(req.query.id, (req as any).user);
  res.status(200).json({ message: "Operation successful", data });
};

export const sendRequisitionReminderHandler = async (req: Request, res: Response) => {
  const data = await sendRequisitionReminder(req.body, (req as any).user);
  res.status(200).json({ message: "Reminder sent", data });
};

export const requisitionAnalyticsHandler = async (req: Request, res: Response) => {
  const data = await getRequisitionAnalytics((req as any).user, {
    from: req.query.from,
    to: req.query.to,
    bucket: req.query.bucket,
    department_id: req.query.department_id,
    branch_id: req.query.branch_id,
  });
  res.status(200).json({ message: "Operation successful", data });
};

export const addRequisitionCommentHandler = async (req: Request, res: Response) => {
  const data = await addRequisitionComment(req.body, (req as any).user);
  res.status(201).json({ message: "Comment added", data });
};
