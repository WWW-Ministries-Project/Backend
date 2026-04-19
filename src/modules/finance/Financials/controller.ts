import { Request, Response } from "express";
import {
  validateFinanceApprovalConfigPayload,
  validateFinancialMutationPayload,
  parseIdFromQuery,
  parsePagination,
  sendFinanceError,
} from "../common";
import { FinancialsService } from "./service";

const financialsService = new FinancialsService();

export class FinancialsController {
  async getApprovalConfig(req: Request, res: Response): Promise<Response> {
    try {
      const config = await financialsService.getApprovalConfig();

      return res.status(200).json({
        message: "Success",
        data: config,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async upsertApprovalConfig(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateFinanceApprovalConfigPayload(req.body);
      const config = await financialsService.upsertApprovalConfig(
        payload,
        (req as any).user?.id,
      );

      return res.status(200).json({
        message: "Finance approval configuration saved successfully",
        data: config,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateFinancialMutationPayload(req.body);
      const result = await financialsService.create(payload, (req as any).user?.id);

      return res.status(201).json({
        message:
          result.triggeredAction === "APPROVED"
            ? "Financial record approved successfully"
            : result.triggeredAction === "APPROVAL_REQUESTED"
              ? "Financial record submitted for approval successfully"
              : "Financial record saved as draft successfully",
        data: result.record,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async findAll(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const result = await financialsService.findAll(
        pagination,
        (req as any).user?.id,
      );

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
      const financial = await financialsService.findOne(id, (req as any).user?.id);

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
      const payload = validateFinancialMutationPayload(req.body);
      const result = await financialsService.update(
        id,
        payload,
        (req as any).user?.id,
      );

      return res.status(200).json({
        message:
          result.triggeredAction === "APPROVED"
            ? "Financial record approved successfully"
            : result.triggeredAction === "APPROVAL_REQUESTED"
              ? "Financial record submitted for approval successfully"
              : "Financial record saved as draft successfully",
        data: result.record,
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
