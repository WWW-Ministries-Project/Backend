import { Request, Response } from "express";
import {
  parseIdFromQuery,
  parsePagination,
  sendFinanceError,
  validateBasePayload,
} from "../common";
import { BankAccountConfigurationService } from "./service";

const bankAccountConfigService = new BankAccountConfigurationService();

export class BankAccountConfigController {
  async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateBasePayload(req.body, { percentageAllowed: true });
      const config = await bankAccountConfigService.create(payload);

      return res.status(201).json({
        message: "Saved successfully",
        data: config,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async findAll(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const result = await bankAccountConfigService.findAll(pagination);

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

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const payload = validateBasePayload(req.body, { percentageAllowed: true });
      const updatedConfig = await bankAccountConfigService.update(id, payload);

      return res.status(200).json({
        message: "Saved successfully",
        data: updatedConfig,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const deleted = await bankAccountConfigService.delete(id);

      return res.status(200).json({
        message: "Deleted successfully",
        data: deleted,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }
}
