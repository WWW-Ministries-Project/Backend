import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
import {
  getRequestAccess,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { isLegacyRole } from "../../permissions/access";
import {
  BRANCH_FORBIDDEN_MESSAGE,
  getBranchScope,
  isBranchAllowed,
} from "../branches/branchScope";

/**
 * Events actions (src/permissions/catalog.ts). Mount after
 * `permissions.withAccess`. `legacyLevel` keeps the rule a route had before
 * actions existed for roles saved before them (e.g. event types needed
 * Manage, `manage_types` defaults to Full).
 */
export const requireEventsAction =
  (action: string, errorMessage: string, legacyLevel?: "view" | "manage" | "admin") =>
  async (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    const userId = access?.userId ?? Number((req as any).user?.id);
    const branchId = getBranchScope()?.activeBranchId ?? null;

    if (userId && (await userHasAction(userId, "Events", action, branchId))) {
      return next();
    }
    if (
      userId &&
      legacyLevel &&
      access &&
      isLegacyRole(access.permissions) &&
      (await userHasBranchDomainPermission(userId, "Events", legacyLevel, branchId))
    ) {
      return next();
    }
    return res
      .status(403)
      .json({ message: errorMessage, data: null, code: "ACTION_FORBIDDEN" });
  };

/** Whether the caller may see who registered (`Events.view_registrations`). */
export const canViewEventRegistrations = async (req: Request) => {
  const userId = Number((req as any).user?.id);
  if (!Number.isInteger(userId) || userId <= 0) return false;
  return userHasAction(userId, "Events", "view_registrations", getBranchScope()?.activeBranchId ?? null);
};

/** Whether every branch id is one the caller may work in. */
export const eventBranchesAllowed = (branchIds: Array<number | null | undefined>) => {
  const scope = getBranchScope();
  return branchIds.every((id) => !id || isBranchAllowed(scope, id));
};

export const sendEventBranchForbidden = (res: Response) =>
  res
    .status(403)
    .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });

/**
 * By-id event operations stay inside the caller's branches. Returns false
 * (and has answered 403) when the event belongs to another branch; a missing
 * event passes so the handler can answer 404 as before.
 */
export const ensureEventInBranch = async (res: Response, eventId: number) => {
  const event = await prisma.event_mgt.findUnique({
    where: { id: eventId },
    select: { branch_id: true },
  });
  if (event && !eventBranchesAllowed([event.branch_id])) {
    sendEventBranchForbidden(res);
    return false;
  }
  return true;
};

/** Same as `ensureEventInBranch` for every occurrence of a series. */
export const ensureSeriesInBranch = async (
  res: Response,
  seriesId: string,
  fromDate?: Date,
) => {
  const events = await prisma.event_mgt.findMany({
    where: {
      recurrence_series_id: seriesId,
      ...(fromDate ? { start_date: { gte: fromDate } } : {}),
    },
    select: { branch_id: true },
  });
  if (!eventBranchesAllowed(events.map((event) => event.branch_id))) {
    sendEventBranchForbidden(res);
    return false;
  }
  return true;
};
