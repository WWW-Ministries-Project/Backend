import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
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
 * By-id promotion routes (and reorder's `ids`) stay inside the caller's
 * branches. Missing ids pass, so the handler answers 400/404 as before.
 */
export const requirePromotionsInBranch = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const paramId = toPositiveInt(req.params?.id);
  const ids = paramId
    ? [paramId]
    : (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map(toPositiveInt)
        .filter((id: number | null): id is number => Boolean(id));
  if (!ids.length) return next();

  const rows = await prisma.promotion.findMany({
    where: { id: { in: ids } },
    select: { branch_id: true },
  });
  const scope = getBranchScope();
  if (rows.some((row) => row.branch_id && !isBranchAllowed(scope, row.branch_id))) {
    return res
      .status(403)
      .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
  }
  return next();
};
