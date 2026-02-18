import { Request, Response } from "express";
import {
  parseIdFromQuery,
  parsePagination,
  sendFinanceError,
  validateFinancialPayload,
} from "../common";
import { FinancialsService } from "./service";

const financialsService = new FinancialsService();

export class FinancialsController {
  async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateFinancialPayload(req.body);
      const financial = await financialsService.create(payload);

      return res.status(201).json({
        message: "Saved successfully",
        data: financial,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async findAll(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const result = await financialsService.findAll(pagination);

      return res.status(200).json({
        message: "Success",
        data: result.data,
        current_page: pagination.page,
        take: pagination.take,
        total: result.total,
        page_size: pagination.take,
        totalPages: Math.ceil(result.total / pagination.take),
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async findOne(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const financial = await financialsService.findOne(id);

      return res.status(200).json({
        message: "Success",
        data: financial,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const payload = validateFinancialPayload(req.body);
      const updatedFinancial = await financialsService.update(id, payload);

      return res.status(200).json({
        message: "Saved successfully",
        data: updatedFinancial,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const deleted = await financialsService.delete(id);

      return res.status(200).json({
        message: "Deleted successfully",
        data: deleted,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }
}
