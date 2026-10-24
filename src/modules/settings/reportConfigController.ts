import { Request, Response } from "express";
import { AppError, InputValidationError } from "../../utils/custom-error-handlers";
import { reportConfigService } from "./reportConfigService";

const getAuthenticatedUserId = (req: Request): number => {
  const parsedUserId = Number((req as any)?.user?.id);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new InputValidationError("Authenticated user not found");
  }

  return parsedUserId;
};

const fail = (res: Response, error: any, fallback: string) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      data: null,
    });
  }

  return res.status(500).json({
    success: false,
    message: fallback,
    data: error?.message ?? null,
  });
};

const reportConfigController = {
  async getConfig(req: Request, res: Response) {
    try {
      const data = await reportConfigService.getConfig(req.query?.branch_id);
      return res.status(200).json({
        success: true,
        message: "Report configuration fetched successfully",
        data,
      });
    } catch (error: any) {
      return fail(res, error, "Failed to fetch report configuration");
    }
  },

  async upsertConfig(req: Request, res: Response) {
    try {
      const updatedByUserId = getAuthenticatedUserId(req);
      const data = await reportConfigService.upsertConfig(
        req.body,
        updatedByUserId,
        req.query?.branch_id,
      );

      return res.status(200).json({
        success: true,
        message: "Report configuration saved successfully",
        data,
      });
    } catch (error: any) {
      return fail(res, error, "Failed to save report configuration");
    }
  },
};

export default reportConfigController;
