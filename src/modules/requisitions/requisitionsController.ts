import { Request, Response } from "express";
import { createRequisition, listRequisition } from "./requisition-service";
import { RequisitionInterface } from "../../interfaces/requisitions-interface";

export const createRequisitionHandler = async (req: Request, res: Response) => {
  const requisitionData: Partial<RequisitionInterface> = req.body;

  try {
    const createdRequisition = await createRequisition(
      requisitionData as RequisitionInterface
    );
    res
      .status(201)
      .json({
        message: "Requisition created successfully",
        data: createdRequisition,
      });
  } catch (error) {
    console.error("Error creating requisition:", error);
    res.status(503).json({ message: "Failed to create requisition", error });
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
