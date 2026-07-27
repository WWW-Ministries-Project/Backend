import { Request, Response } from "express";
import {
  FinanceHttpError,
  parseIdFromQuery,
  parsePagination,
  sendFinanceError,
} from "../common";
import { GivingOptionService } from "./service";
import { validateGivingOptionPayload } from "./validation";

const givingOptionService = new GivingOptionService();

const getActorUserId = (req: Request): number | undefined => {
  const rawId = (req as any)?.user?.id;
  const parsed = Number(rawId);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseBoolean = (value: unknown): boolean =>
  value === true || value === "true" || value === "1";

export class GivingOptionController {
  async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = validateGivingOptionPayload(req.body);
      const givingOption = await givingOptionService.create(
        payload,
        getActorUserId(req),
      );

      return res.status(201).json({
        message: "Giving option created successfully",
        data: givingOption,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async findAll(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const result = await givingOptionService.findAll(
        pagination,
        req.query?.branch_id,
        parseBoolean(req.query?.include_archived),
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
      const id = req.params?.id?.trim();

      if (!id) {
        throw new FinanceHttpError(400, "Invalid id parameter");
      }

      const givingOption = await givingOptionService.findOne(id);

      return res.status(200).json({
        message: "Success",
        data: givingOption,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const payload = validateGivingOptionPayload(req.body);
      const givingOption = await givingOptionService.update(id, payload);

      return res.status(200).json({
        message: "Giving option updated successfully",
        data: givingOption,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async archive(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const givingOption = await givingOptionService.archive(id);

      return res.status(200).json({
        message: givingOption.is_synced
          ? "Giving option archived successfully"
          : "Giving option archived, but Paystack could not be updated. It will need to be re-synced",
        data: givingOption,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async restore(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseIdFromQuery(req);
      const givingOption = await givingOptionService.restore(id);

      return res.status(200).json({
        message: "Giving option restored successfully",
        data: givingOption,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async listBanks(req: Request, res: Response): Promise<Response> {
    try {
      const currency =
        typeof req.query?.currency === "string" && req.query.currency.trim()
          ? req.query.currency.trim()
          : "GHS";

      const banks = await givingOptionService.listBanks(
        currency,
        req.query?.branch_id,
      );

      return res.status(200).json({
        message: "Success",
        data: banks,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }

  async resolveAccount(req: Request, res: Response): Promise<Response> {
    try {
      const accountNumber = String(req.query?.account_number ?? "").trim();
      const bankCode = String(req.query?.bank_code ?? "").trim();

      if (!accountNumber || !bankCode) {
        throw new FinanceHttpError(
          422,
          "account_number and bank_code are both required",
        );
      }

      const resolved = await givingOptionService.resolveAccount(
        { account_number: accountNumber, bank_code: bankCode },
        req.query?.branch_id,
      );

      return res.status(200).json({
        message: resolved
          ? "Success"
          : "Account name could not be resolved. Enter it manually",
        data: resolved,
      });
    } catch (error) {
      return sendFinanceError(res, error);
    }
  }
}
