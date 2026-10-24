import { prisma } from "../../Models/context";

/**
 * Today's members of each department: the user's main department
 * (`user.department_id` / `user_departments`) plus any department where they
 * hold a position — the same roster the church attendance report uses.
 * Only active (`is_active` true/null), non-guest (`is_guest` false/null) users,
 * matching the membership report's definition of a member.
 */
export const departmentRosters = async (
  departmentIds: number[],
  excludedUserIds: Set<number> = new Set(),
): Promise<Map<number, Set<number>>> => {
  const out = new Map<number, Set<number>>();
  const ids = Array.from(new Set(departmentIds));
  if (!ids.length) return out;
  const idSet = new Set(ids);

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { OR: [{ is_active: true }, { is_active: null }] },
        { OR: [{ is_guest: false }, { is_guest: null }] },
        excludedUserIds.size ? { id: { notIn: Array.from(excludedUserIds) } } : {},
        {
          OR: [
            { department_id: { in: ids } },
            { department: { department_id: { in: ids } } },
            { department_positions: { some: { department_id: { in: ids } } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      department_id: true,
      department: { select: { department_id: true } },
      department_positions: { select: { department_id: true } },
    },
  });

  for (const u of users) {
    const mine = new Set<number>();
    if (u.department?.department_id != null && idSet.has(u.department.department_id)) mine.add(u.department.department_id);
    if (u.department_id != null && idSet.has(u.department_id)) mine.add(u.department_id);
    for (const p of u.department_positions) if (idSet.has(p.department_id)) mine.add(p.department_id);
    for (const id of mine) {
      const set = out.get(id) || new Set<number>();
      set.add(u.id);
      out.set(id, set);
    }
  }
  return out;
};
