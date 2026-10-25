import { NextFunction, Request, Response } from "express";

import {
  getRequestAccess,
  Permissions,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { isLegacyRole } from "../../permissions/access";
import { getBranchScope } from "../branches/branchScope";

/**
 * Guards for settings that apply to the whole organisation (branches, report
 * configuration, eligibility rules, alert recipients). Settings is granted
 * per branch, so changing something every branch shares needs the right in
 * every branch the caller holds a role in, whichever branch is selected.
 */

type Level = "view" | "manage" | "admin";

export interface OrgWideRule {
  /** The catalogue action that grants the change, e.g. ["Settings", "configure_general"]. */
  action: [domain: string, action: string];
  /**
   * The rule a role saved before actions (`isLegacyRole`) had, kept so
   * nobody loses access until their role is saved in the new editor.
   */
  legacy?: { domain: string; level: Level; everyBranch: boolean };
}

/** Whether the caller may make an org-wide change under `rule`. */
export const allowsOrgWide = async (
  userId: number,
  permissions: unknown,
  rule: OrgWideRule,
): Promise<boolean> => {
  const [domain, action] = rule.action;
  // null branch: every branch grant must allow it.
  if (await userHasAction(userId, domain, action, null)) return true;
  if (!rule.legacy || !isLegacyRole(permissions)) return false;
  const branchId = rule.legacy.everyBranch ? null : getBranchScope()?.activeBranchId ?? null;
  return userHasBranchDomainPermission(userId, rule.legacy.domain, rule.legacy.level, branchId);
};

/** Route guard for an org-wide change (403 ACTION_FORBIDDEN otherwise). */
export const requireOrgWide = (rule: OrgWideRule, message: string) => {
  const permissions = new Permissions();
  return [
    permissions.protect,
    permissions.withAccess,
    async (req: Request, res: Response, next: NextFunction) => {
      const access = getRequestAccess(req);
      if (access && (await allowsOrgWide(access.userId, access.permissions, rule))) {
        return next();
      }
      return res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });
    },
  ];
};

/** General configuration: `Settings.configure_general` in every branch (legacy: Settings manage in every branch). */
export const CONFIGURE_GENERAL: OrgWideRule = {
  action: ["Settings", "configure_general"],
  legacy: { domain: "Settings", level: "manage", everyBranch: true },
};

/** Report set-up moved from Settings to `Reports.configure` (legacy: Settings manage in every branch). */
export const CONFIGURE_REPORTS: OrgWideRule = {
  action: ["Reports", "configure"],
  legacy: { domain: "Settings", level: "manage", everyBranch: true },
};
