import { Request, Response } from "express";
import { AppError, InputValidationError } from "../../utils/custom-error-handlers";
import { systemNotificationSettingsService } from "./systemNotificationSettingsService";

const getAuthenticatedUserId = (req: Request): number => {
  const parsedUserId = Number((req as any)?.user?.id);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new InputValidationError("Authenticated user not found");
  }

  return parsedUserId;
};

const systemNotificationSettingsController = {
  async getConfig(req: Request, res: Response) {
    try {
      const data = await systemNotificationSettingsService.getConfig();
      return res.status(200).json({
        success: true,
        message: "System notification settings fetched successfully",
        data,
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to fetch system notification settings",
        data: error?.message ?? null,
      });
    }
  },

  async listAdminCandidates(req: Request, res: Response) {
    try {
      const data = await systemNotificationSettingsService.listAdminCandidates();
      return res.status(200).json({
        success: true,
        message: "System notification admin candidates fetched successfully",
        data,
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to fetch system notification admin candidates",
        data: error?.message ?? null,
      });
    }
  },

  async upsertConfig(req: Request, res: Response) {
    try {
      const updatedByUserId = getAuthenticatedUserId(req);
      const data = await systemNotificationSettingsService.upsertConfig(
        req.body,
        updatedByUserId,
      );

      return res.status(200).json({
        success: true,
        message: "System notification settings saved successfully",
        data,
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          data: null,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to save system notification settings",
        data: error?.message ?? null,
      });
    }
  },
};

export default systemNotificationSettingsController;
