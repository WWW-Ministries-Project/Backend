import { Request, Response } from "express";
import { createRequisition } from "../requisitions/requisition-service";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";

export const createRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  try {
    const createdRequisition = await createRequisition(requisitionData as RequisitionInterface);
    res.status(201).json({ message: "Requisition created successfully", data: createdRequisition });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to create requisition", error });
  }
};