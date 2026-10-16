import { prisma } from "../../Models/context";
import { invalidateAuthContext } from "../../middleWare/authorization";
import { departmentMemberIds } from "../community/communityQueries";
import { disconnectUser, toUser } from "./realtimeEmit";
import { refreshRooms } from "./realtimeServer";
import { createSessionNotifier } from "./sessionNotifier";

/**
 * Session events, wired to the real cache, rooms and sockets. Controllers call
 * these after their write commits, with `void`:
 *   void sessionChanged([userId], ["permissions"]);
 *   sessionRevoked(userId, "deactivated");
 */
export const { sessionChanged, sessionRevoked } = createSessionNotifier({
  invalidateAuthContext,
  refreshRooms,
  toUser,
  disconnectUser,
});

/** Users currently holding an access level. Read BEFORE a delete or an unassign. */
export const usersWithAccessLevel = async (accessLevelId: number): Promise<number[]> => {
  const rows = await prisma.user.findMany({
    where: { access_level_id: accessLevelId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
};

/** Active members of a department (positions or memberships). Read BEFORE a delete. */
export const membersOfDepartment = async (departmentId: number): Promise<number[]> =>
  (await departmentMemberIds([departmentId])).get(departmentId) ?? [];
