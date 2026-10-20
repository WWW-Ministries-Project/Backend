import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { roleEligibilityService } from "../settings/roleEligibilityService";
import {
  BuiltInRoleKey,
  LIFE_CENTER_ROLE_NAMES,
  LifeCenterHttpError,
  builtInRoleKey,
  isLeaderRoleName,
} from "./lifeCenterHelpers";

type Db = Prisma.TransactionClient | typeof prisma;

export type BuiltInRoleIds = Record<BuiltInRoleKey, number>;

/**
 * Ids of the Leader, Assistant leader and Member roles, matched
 * case-insensitively. The migration inserts them; any still missing are
 * created here so the leader swap never fails on a fresh database.
 */
export const ensureBuiltInRoles = async (db: Db = prisma): Promise<BuiltInRoleIds> => {
  const roles = await db.life_center_role.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  const ids: Partial<BuiltInRoleIds> = {};
  for (const role of roles) {
    const key = builtInRoleKey(role.name);
    if (key && ids[key] === undefined) ids[key] = role.id;
  }
  for (const key of Object.keys(LIFE_CENTER_ROLE_NAMES) as BuiltInRoleKey[]) {
    if (ids[key] === undefined) {
      const created = await db.life_center_role.create({
        data: { name: LIFE_CENTER_ROLE_NAMES[key] },
      });
      ids[key] = created.id;
    }
  }
  return ids as BuiltInRoleIds;
};

/** Loads the role and, when it is Leader, checks the user may lead. */
export const resolveTargetRole = async (roleId: number, userId: number) => {
  const role = await prisma.life_center_role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true },
  });
  if (!role) throw new LifeCenterHttpError(404, "Role not found");
  const isLeader = isLeaderRoleName(role.name);
  if (isLeader) {
    await roleEligibilityService.assertEligible("life_center_leader", userId);
  }
  return { ...role, isLeader };
};

/**
 * One leader per center: moves every other Leader of the center to
 * Assistant leader. Call inside the transaction that makes `userId` Leader.
 */
export const demoteOtherLeaders = async (
  tx: Prisma.TransactionClient,
  lifeCenterId: number,
  userId: number,
) => {
  const roles = await ensureBuiltInRoles(tx);
  const current = await tx.life_center_member.findMany({
    where: { lifeCenterId, userId: { not: userId } },
    select: { id: true, role: { select: { name: true } } },
  });
  const leaderRowIds = current
    .filter((row) => isLeaderRoleName(row.role?.name))
    .map((row) => row.id);
  if (leaderRowIds.length) {
    await tx.life_center_member.updateMany({
      where: { id: { in: leaderRowIds } },
      data: { roleId: roles.assistant },
    });
  }
};

/**
 * Makes the user the center's Leader (adding them if they aren't a member)
 * and moves the previous leader to Assistant leader. Eligibility must have
 * been checked by the caller.
 */
export const setLeaderTx = async (
  tx: Prisma.TransactionClient,
  lifeCenterId: number,
  userId: number,
) => {
  const roles = await ensureBuiltInRoles(tx);
  await demoteOtherLeaders(tx, lifeCenterId, userId);
  return tx.life_center_member.upsert({
    where: { userId_lifeCenterId: { userId, lifeCenterId } },
    create: { userId, lifeCenterId, roleId: roles.leader },
    update: { roleId: roles.leader },
  });
};
