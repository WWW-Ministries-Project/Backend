/**
 * Where a member came from, as exposed on `GET /user/get-user` (`member_source`).
 * When both links are set, the visitor link wins.
 */
export type MemberSource =
  | null
  | {
      type: "VISITOR";
      visitor: {
        id: number;
        first_visit_at: Date | null;
        last_visit_at: Date | null;
        visit_count: number;
      };
    }
  | {
      type: "SOUL_WON";
      soul_won: {
        id: number;
        date_won: Date | null;
        life_center_name: string | null;
        won_by_name: string | null;
      };
    };

export type MemberSourceVisitorInput = {
  id: number;
  visitDate: Date | null;
  visits: Array<{ date: Date | null }>;
};

export type MemberSourceSoulWonInput = {
  id: number;
  date_won: Date | null;
  lifeCenter?: { name: string | null } | null;
  wonBy?: { name: string | null } | null;
};

const toTime = (value: Date | null | undefined) =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;

/**
 * Visit dates/count come from the visitor's `visit` rows (one is created with
 * the visitor, so `visit_count` matches the visitor list's `visitCount`). The
 * registration `visitDate` also bounds first/last, and stands in as a single
 * visit when no `visit` rows exist (legacy records).
 */
export const summarizeVisitorVisits = (visitor: MemberSourceVisitorInput) => {
  const visitTimes = (visitor.visits || [])
    .map((visit) => toTime(visit?.date))
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  const registeredVisit = toTime(visitor.visitDate);
  const allTimes = registeredVisit
    ? [...visitTimes, registeredVisit.getTime()]
    : visitTimes;

  if (allTimes.length === 0) {
    return { first_visit_at: null, last_visit_at: null, visit_count: 0 };
  }

  return {
    first_visit_at: new Date(Math.min(...allTimes)),
    last_visit_at: new Date(Math.max(...allTimes)),
    visit_count: visitTimes.length > 0 ? visitTimes.length : 1,
  };
};

export const buildMemberSource = (
  visitor: MemberSourceVisitorInput | null | undefined,
  soulWon: MemberSourceSoulWonInput | null | undefined,
): MemberSource => {
  if (visitor) {
    return {
      type: "VISITOR",
      visitor: { id: visitor.id, ...summarizeVisitorVisits(visitor) },
    };
  }

  if (soulWon) {
    return {
      type: "SOUL_WON",
      soul_won: {
        id: soulWon.id,
        date_won: toTime(soulWon.date_won),
        life_center_name: soulWon.lifeCenter?.name ?? null,
        won_by_name: soulWon.wonBy?.name ?? null,
      },
    };
  }

  return null;
};
