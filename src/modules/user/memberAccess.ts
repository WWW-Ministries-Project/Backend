import { Prisma } from "@prisma/client";
import { Response } from "express";
import { prisma } from "../../Models/context";
import { getRequestAccess } from "../../middleWare/authorization";
import { actionAllowed, domainScope, scopeDepartmentIds } from "../../permissions/access";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";

/**
 * Members actions, exclusions and scopes for the user controllers. Every
 * helper reads `req.access`, which the Members guards (`can_*_member_details`)
 * set from the caller's live, active-branch role.
 */

const MEMBERS = "Members";

export const membersActionAllowed = (req: any, action: string): boolean => {
  const access = getRequestAccess(req);
  return Boolean(access && actionAllowed(access.permissions, MEMBERS, action));
};

/** `domain.action` on the caller's live role, for other domains. */
export const callerActionAllowed = (req: any, domain: string, action: string): boolean => {
  const access = getRequestAccess(req);
  return Boolean(access && actionAllowed(access.permissions, domain, action));
};

/** Sends 403 ACTION_FORBIDDEN and returns true when `allowed` is false. */
export const denyAction = (res: Response, allowed: boolean, message: string): boolean => {
  if (allowed) return false;
  res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });
  return true;
};

const toIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

/**
 * People hidden from the caller under Members (the role's "Hidden people").
 * Mirrors the guards' exclusion lookup: a top-level `Members` /
 * `Members_exclusions` list, or the same keys under `Exclusions`.
 */
export const memberExclusionIds = (req: any): number[] => {
  const fromGuard = (req as any)?.memberScope?.exclusions;
  if (Array.isArray(fromGuard)) return toIds(fromGuard);
  const permissions = getRequestAccess(req)?.permissions || {};
  const keys = [MEMBERS, `${MEMBERS}_exclusions`];
  for (const key of keys) {
    const ids = toIds((permissions as any)[key]);
    if (ids.length) return ids;
  }
  const nested = [
    (permissions as any).Exclusions,
    (permissions as any).exclusions,
    (permissions as any).exclusion_list,
    (permissions as any).exclusionList,
  ].find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  if (!nested) return [];
  for (const key of keys) {
    const ids = toIds(nested[key]);
    if (ids.length) return ids;
  }
  return [];
};

/**
 * The Members scope as a user filter: members of the departments the caller
 * leads (or belongs to), or of the life centers they lead (their leadership
 * team and souls won there who became members). Null for the whole branch.
 * The caller always reaches their own record.
 */
export const memberScopeWhere = (req: any): Prisma.userWhereInput | null => {
  const access = getRequestAccess(req);
  if (!access) return null;
  const scope = domainScope(access.permissions, MEMBERS);
  const departmentIds = scopeDepartmentIds(scope, access);
  if (departmentIds) {
    return {
      OR: [
        { id: access.userId },
        { department_id: { in: departmentIds } },
        { department_positions: { some: { department_id: { in: departmentIds } } } },
      ],
    };
  }
  if (scope === "life_center") {
    return {
      OR: [
        { id: access.userId },
        { life_center_member: { some: { lifeCenterId: { in: access.lifeCenterIds } } } },
        { source_soul_won: { is: { lifeCenterId: { in: access.lifeCenterIds } } } },
      ],
    };
  }
  return null;
};

/** Whether the caller may see this person's phone, email and address. */
export const canSeeContactDetails = (req: any, targetUserId?: number | null): boolean => {
  const access = getRequestAccess(req);
  if (access && targetUserId && access.userId === targetUserId) return true;
  return membersActionAllowed(req, "view_contact_details");
};

const CONTACT_FIELDS = [
  "email",
  "primary_number",
  "other_number",
  "country_code",
  "address",
  "city",
  "state_region",
] as const;

/** Nulls phone, email and address on a flattened member row (keys kept). */
export const maskContactDetails = <T extends Record<string, any>>(row: T): T => {
  if (!row || typeof row !== "object") return row;
  const masked: Record<string, any> = { ...row };
  CONTACT_FIELDS.forEach((field) => {
    if (field in masked) masked[field] = null;
  });
  if (masked.user_info && typeof masked.user_info === "object") {
    masked.user_info = maskContactDetails(masked.user_info);
  }
  if (masked.emergency_contact && typeof masked.emergency_contact === "object") {
    masked.emergency_contact = {
      ...masked.emergency_contact,
      phone_number: null,
      country_code: null,
    };
  }
  return masked as T;
};

/**
 * Sends 403 and returns true when any of `userIds` is outside the caller's
 * reach: another branch, hidden from them, or outside their Members scope.
 * Missing users are left to the handler (it answers "not found").
 */
export const denyMembersOutOfReach = async (
  req: any,
  res: Response,
  userIds: Array<number | null | undefined>,
): Promise<boolean> => {
  const access = getRequestAccess(req);
  const ids = Array.from(
    new Set(
      userIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0 && id !== access?.userId),
    ),
  );
  if (!ids.length) return false;

  const forbid = (message: string) => {
    res.status(403).json({ message, data: null, code: "MEMBER_FORBIDDEN" });
    return true;
  };

  const excluded = new Set(memberExclusionIds(req));
  if (ids.some((id) => excluded.has(id))) {
    return forbid("You don't have access to this member.");
  }

  const targets = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, branch_id: true },
  });
  const branchScope = getBranchScope();
  if (
    branchScope &&
    targets.some((target) => target.branch_id && !isBranchAllowed(branchScope, target.branch_id))
  ) {
    return forbid("This member belongs to a branch you don't have access to.");
  }

  const scopeWhere = memberScopeWhere(req);
  if (scopeWhere && targets.length) {
    const reachable = await prisma.user.count({
      where: { AND: [{ id: { in: targets.map((target) => target.id) } }, scopeWhere] },
    });
    if (reachable < targets.length) {
      return forbid("This member is outside the people you look after.");
    }
  }
  return false;
};
