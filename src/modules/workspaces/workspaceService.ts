import { prisma } from "../../Models/context";
import { userHasBranchDomainPermission } from "../../middleWare/authorization";
import { InputValidationError, UnauthorizedError } from "../../utils/custom-error-handlers";
import { getBranchScope } from "../branches/branchScope";
import { assertBranchAccessible, parseBranchId } from "../branches/branchService";
import { buildAdmin } from "./builders/admin";
import { buildFinance } from "./builders/finance";
import { buildGeneric } from "./builders/generic";
import { buildHod } from "./builders/hod";
import { buildPrelate } from "./builders/prelate";
import type { WorkspaceBuilder, WorkspaceContext } from "./types";
import { keepNeeds, resolveRange } from "./widgetKit";
import { WORKSPACE_KEYS, WorkspaceKey, isWorkspaceKey, resolveWorkspaces } from "./workspaceKeys";

const BUILDERS: Record<WorkspaceKey, WorkspaceBuilder> = {
  prelate: buildPrelate,
  admin: buildAdmin,
  finance: buildFinance,
  hod: buildHod,
  generic: buildGeneric,
};

/**
 * Workspaces the user gets in a branch (null = across all their branches).
 * Users without any branch role (members) get the Personal workspace.
 */
export const workspacesForUser = async (userId: number, branchId: number | null): Promise<WorkspaceKey[]> => {
  const grants = await prisma.user_branch_access.findMany({
    where: { user_id: userId, access_level: { deleted: false }, ...(branchId ? { branch_id: branchId } : {}) },
    select: { access_level: { select: { permissions: true, workspaces: true } } },
  });
  if (!grants.length) return ["generic"];
  const set = new Set<WorkspaceKey>();
  grants.forEach((g) => resolveWorkspaces(g.access_level?.workspaces, g.access_level?.permissions).workspaces.forEach((k) => set.add(k)));
  return WORKSPACE_KEYS.filter((k) => set.has(k));
};

export const getWorkspace = async (userId: number, rawWs: unknown, query: Record<string, unknown>) => {
  if (!isWorkspaceKey(rawWs)) throw new InputValidationError("Unknown workspace");
  const ws = rawWs;
  const branchId = parseBranchId(query.branch_id) ?? getBranchScope()?.activeBranchId ?? null;
  if (branchId) assertBranchAccessible(branchId);

  const allowed = await workspacesForUser(userId, branchId);
  if (!allowed.includes(ws)) throw new UnauthorizedError("This workspace isn't part of your role");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const range = resolveRange(query.range);
  const permCache = new Map<string, Promise<boolean>>();
  const ctx: WorkspaceContext = {
    userId,
    userName: user?.name ?? "",
    ws,
    range,
    branchId,
    departmentId: parseBranchId(query.department_id),
    query,
    can: (domain, action) => {
      const key = `${domain}:${action}`;
      if (!permCache.has(key)) permCache.set(key, userHasBranchDomainPermission(userId, domain, action, branchId));
      return permCache.get(key) as Promise<boolean>;
    },
  };

  const built = await BUILDERS[ws](ctx);
  return {
    ws,
    range: {
      key: range.key,
      label: range.label,
      compare_label: range.compare_label,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    greeting_name: (user?.name ?? "").trim().split(/\s+/)[0] ?? "",
    ...(built.departments ? { departments: built.departments } : {}),
    needs: keepNeeds(built.needs, built.widgets),
    widgets: built.widgets,
  };
};
