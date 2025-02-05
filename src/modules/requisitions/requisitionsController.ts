import { Request, Response } from "express";
import {
  createRequisition,
  listRequisition,
  getRequisition,
  updateRequisition,
  deleteRequisition,
  getmyRequisition,
  getStaffRequisition,
} from "./requisition-service";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";

export const createRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  const createdRequisition = await createRequisition(
    requisitionData as RequisitionInterface
  );

  res.status(201).json({
    message: "Requisition created successfully",
    data: createdRequisition,
  });
};
export const updateRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  const user = (req as any).user;

  const updatedRequisition = await updateRequisition(
    requisitionData as RequisitionInterface,
    user
  );
  res.status(201).json({
    message: "Requisition updated successfully",
    data: updatedRequisition,
  });
};

export const listRequisitionHandler = async (req: Request, res: Response) => {
  const requisitions = await listRequisition();
  res.status(200).json({
    message: "Requisitions retrieved successfully",
    data: requisitions,
  });
};

export const userRequisitionsHandler = async (req: Request, res: Response) => {
  const { id } = req.query;

  const response = await getmyRequisition(id);
  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};

export const getRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id) {
    throw new InputValidationError("Requisition ID is required");
  }
  const response = await getRequisition(id);
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

  const response = await getStaffRequisition(user);

  res.status(201).json({
    message: "Operation successful",
    data: response,
  });
};
export const deleteRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;

  if (!id) {
    throw new InputValidationError("Requisition ID is required");
  }
  await deleteRequisition(id);
  res.status(201).json({
    message: "Operation successful",
  });
};
