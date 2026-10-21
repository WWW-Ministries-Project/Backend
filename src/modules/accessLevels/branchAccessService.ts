import { prisma } from "../../Models/context";
import { getBranchScope, isBranchAllowed } from "../branches/branchScope";
import { BranchAccessError } from "../branches/branchService";

export type BranchGrantView = {
  branch_id: number;
  branch_name: string;
  access_level_id: number;
  access_level_name: string;
};

const GRANT_SELECT = {
  branch_id: true,
  access_level_id: true,
  branch: { select: { name: true } },
  access_level: { select: { name: true } },
} as const;

const toGrantView = (grant: {
  branch_id: number;
  access_level_id: number;
  branch: { name: string } | null;
  access_level: { name: string } | null;
}): BranchGrantView => ({
  branch_id: grant.branch_id,
  branch_name: grant.branch?.name ?? "",
  access_level_id: grant.access_level_id,
  access_level_name: grant.access_level?.name ?? "",
});

/** A user's roles, one per branch, sorted by branch id. */
export const listUserBranchGrants = async (
  userId: number,
): Promise<BranchGrantView[]> => {
  const grants = await prisma.user_branch_access.findMany({
    where: { user_id: userId, access_level: { deleted: false } },
    orderBy: { branch_id: "asc" },
    select: GRANT_SELECT,
  });
  return grants.map(toGrantView);
};

/** Roles for many users at once, keyed by user id. */
export const listBranchGrantsByUser = async (
  userIds: number[],
): Promise<Map<number, BranchGrantView[]>> => {
  const byUser = new Map<number, BranchGrantView[]>();
  if (!userIds.length) return byUser;

  const grants = await prisma.user_branch_access.findMany({
    where: { user_id: { in: userIds }, access_level: { deleted: false } },
    orderBy: { branch_id: "asc" },
    select: { user_id: true, ...GRANT_SELECT },
  });
  for (const grant of grants) {
    const list = byUser.get(grant.user_id) ?? [];
    list.push(toGrantView(grant));
    byUser.set(grant.user_id, list);
  }
  return byUser;
};

/**
 * Keeps `user.access_level_id` pointing at one of the user's grants (their home
 * branch's role first) so code that only reads that column still works.
 */
export const syncLegacyAccessLevel = async (userIds: number[]) => {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return;

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      branch_id: true,
      access_level_id: true,
      branch_access: {
        where: { access_level: { deleted: false } },
        orderBy: { branch_id: "asc" },
        select: { branch_id: true, access_level_id: true },
      },
    },
  });

  await Promise.all(
    users.map((user) => {
      const home = user.branch_access.find(
        (grant) => grant.branch_id === user.branch_id,
      );
      const next = (home ?? user.branch_access[0])?.access_level_id ?? null;
      if (next === user.access_level_id) return null;
      return prisma.user.update({
        where: { id: user.id },
        data: { access_level_id: next },
      });
    }),
  );
};

/**
 * Branches the caller may hand out roles in: their own branches, or every
 * branch for a caller with no branch limit.
 */
export const assertCanGrantInBranches = (branchIds: number[]) => {
  const scope = getBranchScope();
  if (branchIds.some((branchId) => !isBranchAllowed(scope, branchId))) {
    throw new BranchAccessError(
      "You can only give access in branches where you have a role",
    );
  }
};

/**
 * The branches a role change applies to when the client did not name one:
 * the active branch, else every branch the caller works in, else all branches.
 */
export const resolveGrantBranchIds = async (
  explicitBranchId: number | null,
): Promise<number[]> => {
  if (explicitBranchId) return [explicitBranchId];

  const scope = getBranchScope();
  if (scope?.activeBranchId) return [scope.activeBranchId];
  if (scope?.allowedBranchIds) return [...scope.allowedBranchIds];

  const branches = await prisma.branch.findMany({ select: { id: true } });
  return branches.map((branch) => branch.id);
};

/**
 * Sets (or with `accessLevelId = null`, removes) a user's role in each of the
 * given branches.
 */
export const setBranchGrants = async (
  userIds: number[],
  branchIds: number[],
  accessLevelId: number | null,
) => {
  if (!userIds.length || !branchIds.length) return;

  if (accessLevelId === null) {
    await prisma.user_branch_access.deleteMany({
      where: { user_id: { in: userIds }, branch_id: { in: branchIds } },
    });
  } else {
    await prisma.$transaction(
      userIds.flatMap((userId) =>
        branchIds.map((branchId) =>
          prisma.user_branch_access.upsert({
            where: {
              user_id_branch_id: { user_id: userId, branch_id: branchId },
            },
            create: {
              user_id: userId,
              branch_id: branchId,
              access_level_id: accessLevelId,
            },
            update: { access_level_id: accessLevelId },
          }),
        ),
      ),
    );
  }

  await syncLegacyAccessLevel(userIds);
};
