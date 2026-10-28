import { Request, Response } from "express";
import { AppError, InputValidationError } from "../../utils/custom-error-handlers";
import { visitorFollowUpSettingsService } from "./visitorFollowUpSettingsService";

const getAuthenticatedUserId = (req: Request): number => {
  const parsedUserId = Number((req as any)?.user?.id);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new InputValidationError("Authenticated user not found");
  }

  return parsedUserId;
};

const visitorFollowUpSettingsController = {
  async getConfig(req: Request, res: Response) {
    try {
      const data = await visitorFollowUpSettingsService.getConfig();
      return res.status(200).json({
        success: true,
        message: "Visitor follow-up settings fetched successfully",
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
        message: "Failed to fetch visitor follow-up settings",
        data: error?.message ?? null,
      });
    }
  },

  async upsertConfig(req: Request, res: Response) {
    try {
      const updatedByUserId = getAuthenticatedUserId(req);
      const data = await visitorFollowUpSettingsService.upsertConfig(
        req.body,
        updatedByUserId,
      );

      return res.status(200).json({
        success: true,
        message: "Visitor follow-up settings saved successfully",
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
        message: "Failed to save visitor follow-up settings",
        data: error?.message ?? null,
      });
    }
  },
};

export default visitorFollowUpSettingsController;
