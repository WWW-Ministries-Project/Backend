import { Request, Response } from "express";
import { AnnualThemeService } from "./service";
import { userHasAction } from "../../middleWare/authorization";
import {
  BRANCH_FORBIDDEN_MESSAGE,
  getBranchScope,
  isBranchAllowed,
} from "../branches/branchScope";

const annualThemeService = new AnnualThemeService();

// `year` is unique, so a clash is the likeliest failure; say so plainly.
const failureMessage = (error: any, fallback: string) =>
  error?.code === "P2002" ? "There is already a theme for that year. Edit that one instead." : fallback;

const inCallerBranch = (branchId: number | null) =>
  !branchId || isBranchAllowed(getBranchScope(), branchId);

const branchForbidden = (res: Response) =>
  res
    .status(403)
    .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });

/** Making a theme the active one is `Theme.publish`; editing it is `Theme.edit`. */
const canPublish = (req: Request) =>
  userHasAction(
    Number((req as any).user?.id),
    "Theme",
    "publish",
    getBranchScope()?.activeBranchId ?? null,
  );

const publishForbidden = (res: Response) =>
  res.status(403).json({
    message: "Not authorized to publish the theme",
    data: null,
    code: "ACTION_FORBIDDEN",
  });

export class AnnualThemeController {
  async create(req: Request, res: Response) {
    if (req.body?.isActive && !(await canPublish(req))) {
      return publishForbidden(res);
    }

    try {
      const theme = await annualThemeService.create(req.body);

      return res.status(201).json({
        message: "Annual theme created successfully",
        data: theme,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: failureMessage(error, "Failed to create annual theme"),
        error: error.message,
      });
    }
  }

  async findAll(req: Request, res: Response) {
    const themes = await annualThemeService.findAll(req.query?.branch_id);

    return res.status(200).json({
      data: themes,
    });
  }

  async findActive(req: Request, res: Response) {
    const theme = await annualThemeService.findActive(req.query?.branch_id);

    return res.status(200).json({
      data: theme,
    });
  }

  async findById(req: Request, res: Response) {
    const { id } = req.query;

    const theme = await annualThemeService.findById(Number(id));

    if (!theme) {
      return res.status(404).json({
        message: "Annual theme not found",
      });
    }

    if (!inCallerBranch(theme.branch_id)) return branchForbidden(res);

    return res.status(200).json({
      data: theme,
    });
  }

  async update(req: Request, res: Response) {
    const { id } = req.query;

    try {
      const existing = await annualThemeService.findById(Number(id));
      if (!existing) {
        return res.status(404).json({ message: "Annual theme not found" });
      }
      if (!inCallerBranch(existing.branch_id)) return branchForbidden(res);
      if (
        req.body?.isActive !== undefined &&
        Boolean(req.body.isActive) !== existing.isActive &&
        !(await canPublish(req))
      ) {
        return publishForbidden(res);
      }

      const updatedTheme = await annualThemeService.update(
        Number(id),
        req.body,
      );

      return res.status(200).json({
        message: "Annual theme updated successfully",
        data: updatedTheme,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: failureMessage(error, "Failed to update annual theme"),
        error: error.message,
      });
    }
  }

  async delete(req: Request, res: Response) {
    const { id } = req.query;

    const existing = Number.isInteger(Number(id))
      ? await annualThemeService.findById(Number(id))
      : null;
    if (existing && !inCallerBranch(existing.branch_id)) return branchForbidden(res);

    await annualThemeService.delete(Number(id));

    return res.status(204).send();
  }
}
