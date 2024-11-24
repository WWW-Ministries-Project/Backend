import { Request, Response } from "express";
import {
  createRequisition,
  listRequisition,
  PSapproveRequisition,
  HODapproveRequisition,
  getRequisition,
  updateRequisition,
  deleteRequisition,
} from "./requisition-service";
import {
  RequisitionInterface,
  RequestApprovals,
} from "../../interfaces/requisitions-interface";

export const createRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  try {
    const createdRequisition = await createRequisition(
      requisitionData as RequisitionInterface
    );
    res.status(201).json({
      message: "Requisition created successfully",
      data: createdRequisition,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to create requisition", error });
  }
};
export const updateRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  try {
    const updatedRequisition = await updateRequisition(
      requisitionData as RequisitionInterface
    );
    res.status(201).json({
      message: "Requisition updated successfully",
      data: updatedRequisition,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to update requisition", error });
  }
};

export const listRequisitionHandler = async (req: Request, res: Response) => {
  try {
    const response = await listRequisition();
    res.status(201).json({
      message: "Operation successful",
      data: response,
    });
  } catch (error) {
    console.error("Error listing requisition:", error);
    res.status(503).json({ message: "Failed to list requisition", error });
  }
};

export const hodApproveRequisitionHandler = async (
  req: Request,
  res: Response
) => {
  const data: Partial<RequestApprovals> = req.body;

  try {
    await HODapproveRequisition(data as RequestApprovals);
    res.status(201).json({
      message: "Requisition Approved successfully by HOD",
      data: null,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to approve requisition", error });
  }
};

export const psApproveRequisitionHandler = async (
  req: Request,
  res: Response
) => {
  const data: Partial<RequestApprovals> = req.body;

  try {
    await PSapproveRequisition(data as RequestApprovals);
    res.status(201).json({
      message: "Requisition Approved successfully By Executive Pastor",
      data: null,
    });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to approve requisition", error });
  }
};

export const getRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;

  try {
    if (!id) {
      res.status(400).json({ message: "Requisition ID is required" });
      return;
    }
    const response = await getRequisition(id);
    res.status(201).json({
      message: "Operation successful",
      data: response,
    });
  } catch (error) {
    console.error("Error retrieving requisition:", error);
    res.status(503).json({ message: "Failed to get requisition", error });
  }
};
export const deleteRequisitionHandler = async (req: Request, res: Response) => {
  const { id } = req.query;

  try {
    if (!id) {
      res.status(400).json({ message: "Requisition ID is required" });
      return;
    }
    await deleteRequisition(id);
    res.status(201).json({
      message: "Operation successful",
    });
  } catch (error) {
    console.error("Error deleting requisition:", error);
    res.status(503).json({ message: "Failed to delete requisition", error });
  }
};
