import { NextFunction, Request, Response } from "express";

import { prisma } from "../../Models/context";
import {
  getRequestAccess,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { domainRank, domainScope, isLegacyRole } from "../../permissions/access";
import { assertBranchAccessible } from "../branches/branchService";
import { getBranchScope } from "../branches/branchScope";
import { LifeCenterHttpError, LifeCenterScope } from "./lifeCenterHelpers";

const DOMAIN = "Life Center";

/**
 * What the caller may do in Life centers, from the live role (after a
 * permission guard set `req.access`) and the centers whose leadership team
 * (life_center_member rows) they are on.
 *
 * - `wholeBranch`: the role sees every center in the branch (scope `branch`).
 *   Otherwise the role's scope is `life_center`: only the centers they lead.
 * - `ledIds`: centers they are on the leadership of. Leader tools (record
 *   souls / meetings, export meetings) work there without any role.
 */
export const lifeCenterAccessOf = (req: Request) => {
  const access = getRequestAccess(req);
  const permissions = access?.permissions ?? {};
  const rank = access?.isPrivilegedUser ? domainRank(permissions, DOMAIN) : 0;
  const ledIds = access?.lifeCenterIds ?? [];
  const wholeBranch = rank > 0 && domainScope(permissions, DOMAIN) === "branch";
  return { userId: access?.userId ?? 0, rank, ledIds, wholeBranch };
};

/**
 * Whether the role grants `Life Center.<action>` in the active branch (every
 * branch when none is active), like `permissions.requireAction`.
 */
export const lifeCenterActionAllowed = async (req: Request, action: string) => {
  const { userId, rank } = lifeCenterAccessOf(req);
  if (!userId || !rank) return false;
  return userHasAction(userId, DOMAIN, action, getBranchScope()?.activeBranchId ?? null);
};

const memberScope = (ids: number[]): LifeCenterScope => ({ mode: "member", lifeCenterIds: ids });
const allScope: LifeCenterScope = { mode: "all", lifeCenterIds: [] };

/**
 * Route guard (after `permissions.withAccess`) that sets `req.lifeCenterScope`.
 * - No action: viewing. Anyone with a Life Center level, or on a center's
 *   leadership, sees their centers (every center with the branch scope).
 * - `action`: the role must grant it; with the `life_center` scope it reaches
 *   only the centers they lead. `leaderTool` also lets a center's leadership
 *   act on their own center without the action.
 * - `wholeBranchOnly`: not for roles limited to their centers (creating one).
 */
export const lifeCenterGuard = (
  options: { action?: string; leaderTool?: boolean; wholeBranchOnly?: boolean } = {},
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { rank, ledIds, wholeBranch } = lifeCenterAccessOf(req);
    const deny = (message = "Not authorized to manage life center data") =>
      res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

    if (!options.action) {
      if (wholeBranch) (req as any).lifeCenterScope = allScope;
      else if (rank > 0 || ledIds.length) (req as any).lifeCenterScope = memberScope(ledIds);
      else return res.status(401).json({ message: "Not authorized to view life center" });
      return next();
    }

    const allowed = await lifeCenterActionAllowed(req, options.action);
    if (allowed && wholeBranch) {
      (req as any).lifeCenterScope = allScope;
      return next();
    }
    if (options.wholeBranchOnly) return deny();
    // A role limited to their centers and a center's leadership both reach
    // only the centers they lead.
    if ((allowed || options.leaderTool) && ledIds.length) {
      (req as any).lifeCenterScope = memberScope(ledIds);
      return next();
    }
    return deny();
  };
};

/**
 * By-id writes on a center must stay inside the caller's branches, unless
 * they reach it as its leadership.
 */
export const assertLifeCenterReachable = async (req: Request, lifeCenterId: number) => {
  if (!Number.isInteger(lifeCenterId) || lifeCenterId <= 0) {
    throw new LifeCenterHttpError(400, "lifeCenterId must be a valid id");
  }
  const scope: LifeCenterScope = (req as any).lifeCenterScope;
  if (scope?.mode === "member") {
    if (!scope.lifeCenterIds.includes(lifeCenterId)) {
      throw new LifeCenterHttpError(403, "Not authorized to manage this life center");
    }
    return;
  }
  const center = await prisma.life_center.findUnique({
    where: { id: lifeCenterId },
    select: { branch_id: true },
  });
  if (!center) throw new LifeCenterHttpError(404, "Life center not found");
  assertBranchAccessible(center.branch_id);
};

/**
 * Creating and renaming center roles: `manage_roles` (Full). A role saved
 * before actions existed keeps the old rule (Manage), so nobody loses it.
 */
export const lifeCenterRolesGuard = async (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  const { userId, rank } = lifeCenterAccessOf(req);
  const allowed =
    (await lifeCenterActionAllowed(req, "manage_roles")) ||
    (Boolean(userId) &&
      rank > 0 &&
      isLegacyRole(access?.permissions) &&
      (await userHasBranchDomainPermission(
        userId,
        DOMAIN,
        "manage",
        getBranchScope()?.activeBranchId ?? null,
      )));
  if (!allowed) {
    return res
      .status(403)
      .json({ message: "Not authorized to manage life center roles", data: null, code: "ACTION_FORBIDDEN" });
  }
  return next();
};
