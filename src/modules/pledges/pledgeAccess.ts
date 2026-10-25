import { Request } from "express";
import { prisma } from "../../Models/context";
import { getRequestAccess } from "../../middleWare/authorization";
import { actionAllowed, domainScope } from "../../permissions/access";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";
import { PledgeHttpError } from "./common";

/**
 * Whose pledges the caller reaches. `assigned` (the default for a View-only
 * Pledges role) limits them to pledges they are a caller on; `branch` is the
 * whole branch. Reads the live permissions a guard put on `req.access`.
 */
export type PledgeViewer = {
  userId: number | null;
  assignedOnly: boolean;
  /** Pledgers' phone numbers and emails (`Pledges.view_payer_details`). */
  payerDetails: boolean;
};

export const pledgeViewer = (req: Request): PledgeViewer => {
  const access = getRequestAccess(req);
  const permissions = access?.permissions ?? {};
  return {
    userId: access?.userId ?? null,
    assignedOnly: domainScope(permissions, "Pledges") === "assigned",
    payerDetails: actionAllowed(permissions, "Pledges", "view_payer_details"),
  };
};

/** Prisma filter for the pledges a viewer may list. */
export const pledgeScopeWhere = (viewer?: PledgeViewer) =>
  viewer?.assignedOnly ? { callers: { some: { user_id: viewer.userId ?? -1 } } } : {};

/**
 * Throws 404 when the pledge doesn't exist or sits outside the caller's
 * branches or scope. By-id reads and writes go through this so an id from
 * another branch can't be read or changed.
 */
export const assertPledgeReachable = async (
  pledgeId: number,
  viewer?: PledgeViewer,
): Promise<{ id: number; branch_id: number | null; isCaller: boolean }> => {
  if (!Number.isInteger(pledgeId) || pledgeId < 1) {
    throw new PledgeHttpError(400, "A valid pledge id is required");
  }
  const pledge = await prisma.pledge.findUnique({
    where: { id: pledgeId },
    select: { id: true, branch_id: true, callers: { select: { user_id: true } } },
  });
  if (!pledge) throw new PledgeHttpError(404, "Pledge not found");
  if (pledge.branch_id && !isBranchAllowed(getBranchScope(), pledge.branch_id)) {
    throw new PledgeHttpError(403, "You don't have access to this branch");
  }
  const isCaller = Boolean(
    viewer?.userId && pledge.callers.some((c) => c.user_id === viewer.userId),
  );
  if (viewer?.assignedOnly && !isCaller) {
    throw new PledgeHttpError(404, "Pledge not found");
  }
  return { id: pledge.id, branch_id: pledge.branch_id, isCaller };
};

/** The pledge a group, pledger, redemption or payment belongs to. */
export const pledgeIdFor = async (
  kind: "group" | "pledger" | "redemption" | "payment",
  id: number | string,
): Promise<number> => {
  let pledgeId: number | null | undefined;
  if (kind === "group") {
    pledgeId = (await prisma.pledge_group.findUnique({ where: { id: Number(id) }, select: { pledge_id: true } }))
      ?.pledge_id;
  } else if (kind === "pledger") {
    pledgeId = (
      await prisma.pledger.findUnique({
        where: { id: Number(id) },
        select: { group: { select: { pledge_id: true } } },
      })
    )?.group?.pledge_id;
  } else if (kind === "redemption") {
    pledgeId = (
      await prisma.pledge_redemption.findUnique({
        where: { id: Number(id) },
        select: { pledger: { select: { group: { select: { pledge_id: true } } } } },
      })
    )?.pledger?.group?.pledge_id;
  } else {
    pledgeId = (
      await prisma.pledge_payment.findUnique({ where: { id: String(id) }, select: { pledge_id: true } })
    )?.pledge_id;
  }
  if (!pledgeId) throw new PledgeHttpError(404, "Record not found");
  return pledgeId;
};
