import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
import { userHasAction } from "../../middleWare/authorization";
import {
  BRANCH_FORBIDDEN_MESSAGE,
  getBranchScope,
  isBranchAllowed,
} from "../branches/branchScope";

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * By-id sermon and series routes stay inside the caller's branches. A missing
 * record passes, so the handler answers 404 as before.
 */
export const requireSermonRecordInBranch =
  (record: "sermon" | "series") =>
  async (req: Request, res: Response, next: NextFunction) => {
    const id = toPositiveInt(req.params?.id);
    if (!id) return next();
    const row =
      record === "sermon"
        ? await prisma.sermon.findUnique({ where: { id }, select: { branch_id: true } })
        : await prisma.sermon_series.findUnique({
            where: { id },
            select: { branch_id: true },
          });
    if (row?.branch_id && !isBranchAllowed(getBranchScope(), row.branch_id)) {
      return res
        .status(403)
        .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
    }
    return next();
  };

/**
 * Sets `req.canViewSermonDrafts` from `Sermons.view_drafts` (View by default)
 * in the active branch. With no branch selected, the older probe
 * (`attach_sermon_management`, Manage in any branch) still counts so nobody
 * loses drafts they saw before. Mount after `attach_sermon_management`.
 */
export const attachSermonDraftAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const anyReq = req as any;
  const userId = toPositiveInt(anyReq.user?.id);
  const branchId = getBranchScope()?.activeBranchId ?? null;
  let allowed = false;
  try {
    allowed = Boolean(userId) && (await userHasAction(userId!, "Sermons", "view_drafts", branchId));
  } catch {
    allowed = false;
  }
  anyReq.canViewSermonDrafts = allowed || (!branchId && Boolean(anyReq.canManageSermons));
  return next();
};
