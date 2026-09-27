import { Request, Response } from "express";
import { AppError, InputValidationError } from "../../utils/custom-error-handlers";
import { eventReportExclusionService } from "./eventReportExclusionService";

const getAuthenticatedUserId = (req: Request): number => {
  const parsedUserId = Number((req as any)?.user?.id);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new InputValidationError("Authenticated user not found");
  }

  return parsedUserId;
};

const eventReportExclusionController = {
  async list(req: Request, res: Response) {
    try {
      const data = await eventReportExclusionService.list();
      return res.status(200).json({
        success: true,
        message: "Event report exclusions fetched successfully",
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
        message: "Failed to fetch event report exclusions",
        data: error?.message ?? null,
      });
    }
  },

  async replace(req: Request, res: Response) {
    try {
      const updatedByUserId = getAuthenticatedUserId(req);
      const data = await eventReportExclusionService.replace(
        req.body,
        updatedByUserId,
      );

      return res.status(200).json({
        success: true,
        message: "Event report exclusions saved successfully",
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
        message: "Failed to save event report exclusions",
        data: error?.message ?? null,
      });
    }
  },
};

export default eventReportExclusionController;
