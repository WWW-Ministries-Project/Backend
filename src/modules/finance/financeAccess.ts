import { NextFunction, Request, Response } from "express";
import {
  getRequestAccess,
  hasActionPermission,
} from "../../middleWare/authorization";
import { actionAllowed, isLegacyRole } from "../../permissions/access";

/** Live, active-branch permissions set by a permission guard (e.g. withAccess). */
export const financePermissions = (req: Request): Record<string, any> =>
  getRequestAccess(req)?.permissions ?? {};

/**
 * Finance configurations (receipt lines, payment methods, bank accounts,
 * tithe split) moved from Settings to `Financials.configure`. Reading them is
 * open to anyone who works on finance records. Roles saved before actions
 * existed keep the old Settings rule. Use after `permissions.withAccess`.
 */
export const requireFinanceConfigAccess =
  (level: "view" | "manage" | "admin") =>
  (req: Request, res: Response, next: NextFunction) => {
    const permissions = financePermissions(req);
    const allowed =
      level === "view"
        ? hasActionPermission(permissions, "Financials", "view") ||
          hasActionPermission(permissions, "Settings", "view")
        : actionAllowed(permissions, "Financials", "configure") ||
          (isLegacyRole(permissions) &&
            hasActionPermission(permissions, "Settings", level));

    if (allowed) return next();
    return res.status(403).json({
      message: "Not authorized to manage finance configurations",
      data: null,
      code: "ACTION_FORBIDDEN",
    });
  };
