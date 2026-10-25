import { NextFunction, Request, Response } from "express";

import {
  getRequestAccess,
  Permissions,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { domainRank, isLegacyRole } from "../../permissions/access";
import { getBranchScope } from "../branches/branchScope";

/**
 * Who may do what on event reports. Event reports moved from Events to the
 * Reports domain: each right is a Reports action, and a role saved before
 * actions existed (`isLegacyRole`) keeps the Events rule it had.
 */

export type EventReportRight = "read" | "generate" | "comment" | "export" | "configure_approvals";

const REPORTS_ACTION: Record<Exclude<EventReportRight, "read">, string> = {
  generate: "event_generate",
  comment: "event_comment",
  export: "event_export",
  configure_approvals: "event_configure_approvals",
};

/** The Events level a role saved before actions needed for each right. */
const LEGACY_EVENTS_LEVEL: Record<EventReportRight, "view" | "manage"> = {
  read: "view",
  generate: "manage",
  comment: "view",
  export: "view",
  configure_approvals: "manage",
};

const activeBranchId = () => getBranchScope()?.activeBranchId ?? null;

/**
 * Whether the caller holds `right`. Branch rule as the route guards: with a
 * branch selected that branch's role decides; with "all branches" reading
 * needs it in any branch and changing in every branch.
 */
export const hasEventReportRight = async (
  userId: number,
  permissions: unknown,
  right: EventReportRight,
): Promise<boolean> => {
  const branchId = activeBranchId();
  const legacyEvents = (level: "view" | "manage") =>
    userHasBranchDomainPermission(userId, "Events", level, branchId);

  if (right === "read") {
    // Reading follows either domain: event reports are Events data too.
    return (
      (await userHasBranchDomainPermission(userId, "Reports", "view", branchId)) ||
      (await legacyEvents("view"))
    );
  }
  if (await userHasAction(userId, "Reports", REPORTS_ACTION[right], branchId)) return true;
  return isLegacyRole(permissions) && (await legacyEvents(LEGACY_EVENTS_LEVEL[right]));
};

/** Route guard: signed in, plus `right` (403 ACTION_FORBIDDEN otherwise). */
export const requireEventReportRight = (right: EventReportRight, message: string) => {
  const permissions = new Permissions();
  return [
    permissions.protect,
    permissions.withAccess,
    async (req: Request, res: Response, next: NextFunction) => {
      const access = getRequestAccess(req);
      if (access && (await hasEventReportRight(access.userId, access.permissions, right))) {
        return next();
      }
      return res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });
    },
  ];
};

/** `Actions.Reports.<action>` when the role switched it on or off on purpose. */
export const reportsActionOverride = (permissions: unknown, action: string): boolean | undefined => {
  const value = (permissions as any)?.Actions?.Reports?.[action];
  return typeof value === "boolean" ? value : undefined;
};

/**
 * Sign-off outside a configured chain: Full on Reports, an on-purpose
 * `event_approve`, or (roles saved before actions) Full on Events as before.
 */
export const canSignOffWithoutChain = (permissions: unknown): boolean => {
  const override = reportsActionOverride(permissions, "event_approve");
  if (override !== undefined) return override && domainRank(permissions, "Reports") > 0;
  return (
    domainRank(permissions, "Reports") >= 3 ||
    (isLegacyRole(permissions) && domainRank(permissions, "Events") >= 3)
  );
};

/** Full on Reports may act at any step of a configured chain. */
export const canOverrideChain = (permissions: unknown): boolean =>
  reportsActionOverride(permissions, "event_approve") !== false &&
  domainRank(permissions, "Reports") >= 3;
