import { prisma } from "../../Models/context";
import { AppError } from "../../utils/custom-error-handlers";
import {
  BRANCH_FORBIDDEN_MESSAGE,
  getBranchScope,
  isBranchAllowed,
} from "./branchScope";

export const DEFAULT_BRANCH_NAME = "Main branch";

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

export const ensureMainBranch = async () => {
  const existingDefault = await prisma.branch.findFirst({
    where: { is_default: true },
  });

  if (existingDefault) {
    return existingDefault;
  }

  const existingByName = await prisma.branch.findFirst({
    where: { name: DEFAULT_BRANCH_NAME },
  });

  if (existingByName) {
    return prisma.branch.update({
      where: { id: existingByName.id },
      data: { is_default: true },
    });
  }

  return prisma.branch.create({
    data: {
      name: DEFAULT_BRANCH_NAME,
      is_default: true,
    },
  });
};

export const parseBranchId = (value: unknown): number | null =>
  toPositiveInt(value);

export class BranchAccessError extends AppError {
  constructor(message = BRANCH_FORBIDDEN_MESSAGE) {
    super(message, 403);
  }
}

/**
 * The branch filter a list should use: the branch the caller asked for (query
 * value, else the active branch from `X-Branch-Id`), clamped to the branches
 * the caller may see. With no branch asked for, an admin limited to some
 * branches gets `{ in: [...] }`; anyone else gets no filter.
 */
const resolveListBranchFilter = (
  value: unknown,
): number | { in: number[] } | undefined => {
  const scope = getBranchScope();
  const branchId = parseBranchId(value) ?? scope?.activeBranchId ?? null;

  if (branchId) {
    // An id outside the caller's branches matches nothing rather than leaking.
    return isBranchAllowed(scope, branchId) ? branchId : { in: [] };
  }

  if (scope?.allowedBranchIds) {
    return { in: scope.allowedBranchIds };
  }

  return undefined;
};

export const getBranchScopedWhere = (
  value: unknown,
  field = "branch_id",
): Record<string, any> | undefined => {
  const filter = resolveListBranchFilter(value);
  if (filter === undefined) {
    return undefined;
  }

  return {
    [field]: filter,
  };
};

export const getRelationBranchScopedWhere = (
  value: unknown,
  relation: string,
): Record<string, { is: { branch_id: any } }> | undefined => {
  const filter = resolveListBranchFilter(value);
  if (filter === undefined) {
    return undefined;
  }

  return {
    [relation]: {
      is: {
        branch_id: filter,
      },
    },
  };
};

/**
 * The branch a record is written to. A missing value falls back to the active
 * branch, then (for an admin with one branch) their branch, then the main
 * branch. Writing to a branch the caller holds no role in throws
 * `BranchAccessError`.
 */
export const resolveBranchIdOrDefault = async (value: unknown) => {
  const scope = getBranchScope();
  const parsedBranchId =
    parseBranchId(value) ??
    scope?.activeBranchId ??
    (scope?.allowedBranchIds?.length ? scope.allowedBranchIds[0] : null);

  if (!parsedBranchId) {
    const mainBranch = await ensureMainBranch();
    return mainBranch.id;
  }

  if (!isBranchAllowed(scope, parsedBranchId)) {
    throw new BranchAccessError();
  }

  const existingBranch = await prisma.branch.findUnique({
    where: { id: parsedBranchId },
    select: { id: true },
  });

  if (!existingBranch) {
    throw new Error("Branch not found");
  }

  return existingBranch.id;
};

/**
 * Throws `BranchAccessError` when a record's branch is outside the caller's
 * branches. For by-id reads and writes that do not go through a list filter.
 */
export const assertBranchAccessible = (branchId: unknown) => {
  const parsed = parseBranchId(branchId);
  if (parsed && !isBranchAllowed(getBranchScope(), parsed)) {
    throw new BranchAccessError();
  }
};

export const normalizeBranchListItem = (
  branch: Awaited<ReturnType<typeof prisma.branch.findFirst>>,
) => {
  if (!branch) {
    return null;
  }

  return {
    id: branch.id,
    name: branch.name,
    description: branch.description,
    location: (branch as any).location ?? null,
    pastor_in_charge_id: (branch as any).pastor_in_charge_id ?? null,
    pastor_in_charge: (branch as any).pastor_in_charge ?? null,
    is_default: branch.is_default,
    created_at: branch.created_at,
    updated_at: branch.updated_at,
  };
};
