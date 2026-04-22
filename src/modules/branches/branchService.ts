import { prisma } from "../../Models/context";

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

export const getBranchScopedWhere = (
  value: unknown,
  field = "branch_id",
): Record<string, number> | undefined => {
  const branchId = parseBranchId(value);
  if (!branchId) {
    return undefined;
  }

  return {
    [field]: branchId,
  };
};

export const getRelationBranchScopedWhere = (
  value: unknown,
  relation: string,
): Record<string, { is: { branch_id: number } }> | undefined => {
  const branchId = parseBranchId(value);
  if (!branchId) {
    return undefined;
  }

  return {
    [relation]: {
      is: {
        branch_id: branchId,
      },
    },
  };
};

export const resolveBranchIdOrDefault = async (value: unknown) => {
  const parsedBranchId = parseBranchId(value);

  if (!parsedBranchId) {
    const mainBranch = await ensureMainBranch();
    return mainBranch.id;
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
