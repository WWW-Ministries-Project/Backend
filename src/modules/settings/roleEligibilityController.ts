import { Request, Response } from "express";
import { AppError } from "../../utils/custom-error-handlers";
import { roleEligibilityService } from "./roleEligibilityService";

const roleEligibilityController = {
  async getConfig(req: Request, res: Response) {
    try {
      const response = await roleEligibilityService.getConfig();
      return res.status(200).json({
        success: true,
        message: "Role eligibility config fetched successfully",
        data: response,
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
        message: "Failed to fetch role eligibility config",
        data: error?.message ?? null,
      });
    }
  },

  async upsertConfig(req: Request, res: Response) {
    try {
      const response = await roleEligibilityService.upsertConfig(req.body);
      return res.status(200).json({
        success: true,
        message: "Role eligibility config saved successfully",
        data: response,
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
        message: "Failed to save role eligibility config",
        data: error?.message ?? null,
      });
    }
  },
};

export default roleEligibilityController;
