import { prisma } from "../../Models/context";
import { resolveDomainLevel } from "../../middleWare/authorization";
import { AppError } from "../../utils/custom-error-handlers";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";

/**
 * Guards against granting more access than the person granting it holds
 * (Frontend docs/permissions/PERMISSIONS_AUDIT_AND_REDESIGN.md, S4):
 * - a role may not carry a level above the editor's own for that module;
 * - an action switched on by hand needs the editor to hold it too (or Full on
 *   that module);
 * - nobody edits a role they hold, or changes their own assignment.
 */
export class GrantCeilingError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

const LEVEL_RANK: Record<string, number> = {
  No_Access: 0,
  Can_View: 1,
  Can_Manage: 2,
  Super_Admin: 3,
};

const LEVEL_LABEL = ["None", "View", "Manage", "Full"];

const rankOf = (value: unknown) =>
  typeof value === "string" ? LEVEL_RANK[value] ?? 0 : 0;

const parse = (permissions: unknown): Record<string, any> => {
  if (!permissions) return {};
  if (typeof permissions === "string") {
    try {
      const parsed = JSON.parse(permissions);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return typeof permissions === "object" && !Array.isArray(permissions)
    ? (permissions as Record<string, any>)
    : {};
};

const NON_LEVEL_KEYS = new Set(["Exclusions", "Scopes", "Actions"]);

/**
 * Throws when `granted` (a normalized permission payload) asks for a level or
 * a hand-picked action that `callerPermissions` (the caller's live, active
 * branch permissions) doesn't hold. With `previous` (the role as stored), only
 * what goes up is checked, so an editor can still save a role that already
 * holds more than they do in a module they didn't touch.
 */
export const assertWithinCeiling = (
  callerPermissions: unknown,
  granted: unknown,
  previous?: unknown,
) => {
  const caller = parse(callerPermissions);
  const next = parse(granted);
  const before = previous === undefined ? null : parse(previous);

  for (const [domain, value] of Object.entries(next)) {
    if (NON_LEVEL_KEYS.has(domain)) continue;
    const wanted = rankOf(value);
    const held = rankOf(resolveDomainLevel(caller, domain));
    const had = before ? rankOf(resolveDomainLevel(before, domain)) : 0;
    if (wanted > held && wanted > had) {
      throw new GrantCeilingError(
        `You can only give what you have yourself. ${domain.replace(/_/g, " ")} needs ${LEVEL_LABEL[wanted]} access, and you have ${LEVEL_LABEL[held]}.`,
      );
    }
  }

  const actions = parse(next.Actions);
  const callerActions = parse(caller.Actions);
  const actionsBefore = parse(before?.Actions);
  for (const [domain, map] of Object.entries(actions)) {
    const heldFull = rankOf(resolveDomainLevel(caller, domain)) >= LEVEL_RANK.Super_Admin;
    for (const [action, on] of Object.entries(parse(map))) {
      if (on !== true || heldFull) continue;
      if (parse(actionsBefore[domain])[action] === true) continue;
      if (parse(callerActions[domain])[action] !== true) {
        throw new GrantCeilingError(
          `You can only give what you have yourself. You can't switch on ${domain.replace(/_/g, " ")} › ${action.replace(/_/g, " ")}.`,
        );
      }
    }
  }
};

/** Throws when the caller holds this role in any branch. */
export const assertNotOwnRole = async (
  callerId: number | null,
  accessLevelId: number,
) => {
  if (!callerId) return;
  const held = await prisma.user_branch_access.findFirst({
    where: { user_id: callerId, access_level_id: accessLevelId },
    select: { id: true },
  });
  if (held) {
    throw new GrantCeilingError(
      "You have this role. Nobody can change their own access, so another admin has to edit it.",
    );
  }
};

/** Throws when the caller is among the people whose role is being changed. */
export const assertNotSelf = (callerId: number | null, userIds: number[]) => {
  if (callerId && userIds.includes(callerId)) {
    throw new GrantCeilingError(
      "Nobody can change their own access, so another admin has to do it.",
    );
  }
};

/** Throws when assigning `accessLevelId` would give someone more than the caller holds. */
export const assertRoleWithinCeiling = async (
  callerPermissions: unknown,
  accessLevelId: number,
) => {
  const role = await prisma.access_level.findUnique({
    where: { id: accessLevelId },
    select: { permissions: true },
  });
  if (role) assertWithinCeiling(callerPermissions, role.permissions);
};

/**
 * Throws when the role is given in a branch the caller has no role in. Roles
 * are shared across branches, so changing one there would change access the
 * caller doesn't administer.
 */
export const assertAdministersRoleBranches = async (accessLevelId: number) => {
  const scope = getBranchScope();
  const grants = await prisma.user_branch_access.findMany({
    where: { access_level_id: accessLevelId },
    distinct: ["branch_id"],
    select: { branch_id: true, branch: { select: { name: true } } },
  });
  const outside = grants.filter((grant) => !isBranchAllowed(scope, grant.branch_id));
  if (outside.length) {
    const names = outside.map((grant) => grant.branch?.name || `branch ${grant.branch_id}`);
    throw new GrantCeilingError(
      `This role is also used in ${names.join(" and ")}, where you don't have a role. An admin there has to change it.`,
    );
  }
};
