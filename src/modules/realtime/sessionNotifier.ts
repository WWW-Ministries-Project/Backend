import type { RealtimeEventMap, SessionChangeReason, SessionRevokeReason } from "./realtimeEvents";

/**
 * What every session change point does, in order:
 * changed — drop the cached auth snapshot, re-join audience rooms, tell the user;
 * revoked — drop the snapshot, tell the user, then disconnect every socket.
 * Never throws: callers fire and forget after their write commits.
 */

export type SessionNotifierDeps = {
  invalidateAuthContext: (userId: number) => void;
  refreshRooms: (userId: number) => Promise<void>;
  toUser: <N extends keyof RealtimeEventMap>(userId: number, event: N, body: RealtimeEventMap[N]) => void;
  disconnectUser: (userId: number) => void;
};

export const createSessionNotifier = (deps: SessionNotifierDeps) => {
  const sessionChanged = async (userIds: number[], reasons: SessionChangeReason[]) => {
    if (!reasons.length) return;
    for (const userId of Array.from(new Set(userIds))) {
      try {
        deps.invalidateAuthContext(userId);
      } catch {
        // cache miss is harmless
      }
      try {
        await deps.refreshRooms(userId);
      } catch {
        // rooms catch up on the next connect; the event still goes out
      }
      deps.toUser(userId, "session.changed", { reasons });
    }
  };

  const sessionRevoked = (userId: number, reason: SessionRevokeReason) => {
    try {
      deps.invalidateAuthContext(userId);
    } catch {
      // cache miss is harmless
    }
    deps.toUser(userId, "session.revoked", { reason });
    deps.disconnectUser(userId);
  };

  return { sessionChanged, sessionRevoked };
};

type UserSessionFields = {
  is_user: boolean | null;
  access_level_id: number | null;
  department_id: number | null;
  branch_id: number | null;
};

/** Narrows `updateUser`'s reasons to what actually changed. Profile always changes. */
export const sessionReasonsForUserUpdate = (
  before: UserSessionFields,
  after: UserSessionFields,
  departmentPositionsReplaced: boolean,
): SessionChangeReason[] => {
  const reasons: SessionChangeReason[] = ["profile"];
  if (Boolean(before.is_user) !== Boolean(after.is_user) || (before.access_level_id ?? null) !== (after.access_level_id ?? null)) {
    reasons.push("permissions");
  }
  if (
    departmentPositionsReplaced ||
    (before.department_id ?? null) !== (after.department_id ?? null) ||
    (before.branch_id ?? null) !== (after.branch_id ?? null)
  ) {
    reasons.push("departments");
  }
  return reasons;
};
