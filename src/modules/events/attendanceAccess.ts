import type { NextFunction, Request, Response } from "express";

import { prisma } from "../../Models/context";
import { getRequestAccess, hasActionPermission } from "../../middleWare/authorization";
import { actionAllowed, domainScope, isLegacyRole, scopeDepartmentIds } from "../../permissions/access";
import { assertBranchAccessible } from "../branches/branchService";

/**
 * Church attendance access helpers. Run after a permission guard that sets
 * `req.access` (`permissions.withAccess` or `permissions.requireAction`).
 */

const DOMAIN = "Church_Attendance";

/**
 * The departments a Church_Attendance department scope reaches, or `null`
 * when the role sees the whole branch.
 */
export const attendanceDepartmentIds = (req: Request): number[] | null => {
  const access = getRequestAccess(req);
  if (!access) return null;
  return scopeDepartmentIds(domainScope(access.permissions, DOMAIN), access);
};

export const attendanceActionAllowed = (req: Request, action: string): boolean => {
  const access = getRequestAccess(req);
  return Boolean(access?.isPrivilegedUser && actionAllowed(access.permissions, DOMAIN, action));
};

const forbidden = (res: Response, message: string) =>
  res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

/**
 * Allows the request when the role has one of `actions` on Church_Attendance,
 * or — for a role saved before actions existed — the Settings level these
 * rights were borrowed from (devices, attendance timing).
 */
export const requireAttendanceActionOrLegacySettings = (
  actions: string[],
  legacySettingsLevel: "view" | "manage" | "admin",
  message: string,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    if (!access?.isPrivilegedUser) return forbidden(res, message);
    if (actions.some((action) => actionAllowed(access.permissions, DOMAIN, action))) {
      return next();
    }
    if (
      isLegacyRole(access.permissions) &&
      hasActionPermission(access.permissions, "Settings", legacySettingsLevel)
    ) {
      return next();
    }
    return forbidden(res, message);
  };
};

/** Arrival windows: anyone who can read attendance, or Settings viewers as before. */
export const requireAttendanceOrSettingsView = (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  if (
    access?.isPrivilegedUser &&
    (hasActionPermission(access.permissions, DOMAIN, "view") ||
      hasActionPermission(access.permissions, "Settings", "view"))
  ) {
    return next();
  }
  return forbidden(res, "Not authorized to view attendance timing");
};

/** Headcounts are church-wide, so writing them needs the whole branch. */
export const requireBranchWideAttendance = (req: Request, res: Response, next: NextFunction) => {
  if (attendanceDepartmentIds(req) !== null) {
    return forbidden(
      res,
      "Your attendance access covers only your departments, so you can't change service headcounts",
    );
  }
  return next();
};

/** Applying check-ins as official attendance (not a preview) needs `record_official`. */
export const requireRecordOfficialUnlessPreview = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const dryRun = req.body?.dryRun ?? req.body?.dry_run;
  const isPreview = dryRun === true || dryRun === "true" || dryRun === 1 || dryRun === "1";
  if (isPreview || attendanceActionAllowed(req, "record_official")) return next();
  return forbidden(res, "Not authorized to record check-ins as official attendance");
};

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Whether a record's branch is one the caller can reach. */
export const branchReachable = (branchId: unknown): boolean => {
  try {
    assertBranchAccessible(branchId);
    return true;
  } catch {
    return false;
  }
};

/** Whether every event is in a branch the caller can reach (missing events pass; the service 404s). */
export const eventsInCallerBranches = async (eventIds: number[]): Promise<boolean> => {
  if (!eventIds.length) return true;
  const events = await prisma.event_mgt.findMany({
    where: { id: { in: eventIds } },
    select: { branch_id: true },
  });
  return events.every((event) => branchReachable(event.branch_id));
};

/**
 * The body to hand the biometric import service: the events must be in the
 * caller's branches, and a department-scoped role only records check-ins of
 * members of its departments. Returns an error to send instead when refused.
 */
export const scopedImportRequest = async (
  req: Request,
): Promise<{ body: Record<string, unknown> } | { status: number; message: string }> => {
  const body = { ...(req.body || {}) } as Record<string, unknown>;
  delete body.scopeDepartmentIds;

  const ids = [body.eventId, body.event_id, ...(Array.isArray(body.eventIds) ? body.eventIds : []),
    ...(Array.isArray(body.event_ids) ? body.event_ids : [])]
    .map(toPositiveInt)
    .filter((id): id is number => Boolean(id));
  if (!(await eventsInCallerBranches(Array.from(new Set(ids))))) {
    return { status: 403, message: "You don't have access to this branch" };
  }

  const departmentIds = attendanceDepartmentIds(req);
  if (departmentIds) {
    if (!departmentIds.length) {
      return { status: 403, message: "Your attendance access covers departments you don't lead or belong to yet" };
    }
    body.scopeDepartmentIds = departmentIds;
  }
  return { body };
};
