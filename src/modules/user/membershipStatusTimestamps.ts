/**
 * Membership stage timestamps on `user`:
 * - `confirmed_at`  — when the member reached CONFIRMED
 * - `functional_at` — when the member reached MEMBER (functional member)
 *
 * Every path that writes `user.status` spreads the result of
 * `buildMembershipStatusTimestampData` into the same write so the stamps stay
 * in step with the status. Pure — no Prisma access — so it is unit tested.
 */

export type MembershipStatusTimestamps = {
  confirmed_at?: Date | null;
  functional_at?: Date | null;
};

type PreviousMembershipState = {
  status?: string | null;
  confirmed_at?: Date | null;
  functional_at?: Date | null;
} | null | undefined;

const normalizeStatus = (status: unknown): string | null => {
  if (status === null || status === undefined) return null;
  const normalized = String(status).trim().toUpperCase();
  return normalized || null;
};

/**
 * Timestamp fields to write alongside a status change.
 *
 * - Status unchanged → `{}` (stamps untouched).
 * - UNCONFIRMED / null → both cleared.
 * - CONFIRMED → `confirmed_at` kept (or set to now if missing), `functional_at` cleared.
 * - MEMBER → both kept (or set to now if missing), so skipping a stage stamps both.
 * - Any other value → `{}`.
 *
 * Pass `previous = null` for a newly created user.
 */
export const buildMembershipStatusTimestampData = (
  previous: PreviousMembershipState,
  nextStatus: unknown,
  now: Date = new Date(),
): MembershipStatusTimestamps => {
  const next = normalizeStatus(nextStatus);
  const prior = previous ? normalizeStatus(previous.status) : undefined;

  if (previous && prior === next) {
    return {};
  }

  if (next === null || next === "UNCONFIRMED") {
    // A new user with no status has nothing to clear.
    return previous ? { confirmed_at: null, functional_at: null } : {};
  }

  if (next === "CONFIRMED") {
    return {
      confirmed_at: previous?.confirmed_at ?? now,
      functional_at: null,
    };
  }

  if (next === "MEMBER") {
    return {
      confirmed_at: previous?.confirmed_at ?? now,
      functional_at: previous?.functional_at ?? now,
    };
  }

  return {};
};
