import { Request, Response } from "express";
import {  FinacialsService }  from "./service";


const financialService = new FinacialsService();

export class FinancialsController {
  async create(req: Request, res: Response) {
    try {
      const data = await financialService.create(req.body);
      return res.status(201).json({
        message: "Financial data created successfully",
        data,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: "Failed to create financial data",
        error: error.message,
      });
    }
  }

  async fetchEmptyFinancialData(req: Request, res: Response) {
    try {
      const data = await financialService.fetchEmptyFinancialData();
      return res.status(200).json({
        data,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch empty financial data",
        error: error.message,
      });
    }
  }

  async findAll(req: Request, res: Response) {
    try {
      const data = await financialService.findAll();
      return res.status(200).json({
        data,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch financial data",
        error: error.message,
      });
    }
  }

  async findById(req: Request, res: Response) {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ message: "Invalid financial data ID" });
    }

    try {
      const data = await financialService.findById(Number(id));
      return res.status(200).json({
        data,
      });
    } catch (error: any) {
      return res.status(404).json({
        message: "Financial data not found",
        error: error.message,
      });
    }
  }

  async update(req: Request, res: Response) {
    const { id } = req.query;

    if (!id ) {
      return res.status(400).json({ message: "Invalid financial data ID" });
    }

    try {
      const updatedData = await financialService.update(Number(id), req.body);
      return res.status(200).json({
        message: "Financial data updated successfully",
        data: updatedData,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: "Failed to update financial data",
        error: error.message,
      });
    }
  }

  async delete(req: Request, res: Response) {
    const { id } = req.query;

    if (!id ) {
      return res.status(400).json({ message: "Invalid financial data ID" });
    }

    try {
      await financialService.delete(Number(id));
      return res.status(200).json({
        message: "Financial data deleted successfully",
      });
    } catch (error: any) {
      return res.status(400).json({
        message: "Failed to delete financial data",
        error: error.message,
      });
    }
  }
}
