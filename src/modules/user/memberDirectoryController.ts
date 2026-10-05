import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { getBranchScopedWhere } from "../branches/branchService";

/*
 * Member-facing directory. Any authenticated user may call these, so the
 * payload is deliberately limited to name + where someone serves: no email,
 * phone, address or member id. Contact details stay behind the privileged
 * `can_view_member_details` routes (`list-users`, `search-users`, `get-user`).
 */

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// `deleteOwnAccount` anonymises instead of deleting: the row stays, renamed
// "Deleted User {id}" with is_active=false. Exclude both signals so a stale
// is_active can never surface an anonymised account. Guests (self-registered
// from the app, not members) are not part of the member directory either.
const activeMemberWhere: Prisma.userWhereInput = {
  AND: [
    { OR: [{ is_active: true }, { is_active: null }] },
    { NOT: { name: { startsWith: "Deleted User" } } },
    { OR: [{ is_guest: false }, { is_guest: null }] },
  ],
};

/**
 * GET /user/directory?q=&department_id=&branch_id=&page=1&take=50
 * Active members, name-ordered, paginated. `q` matches the member's name or
 * the name of a department they belong to.
 */
export const listMemberDirectory = async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const departmentId = toPositiveInt(req.query.department_id);
  const page = toPositiveInt(req.query.page) ?? 1;
  const take = Math.min(toPositiveInt(req.query.take) ?? DEFAULT_TAKE, MAX_TAKE);
  const branchWhere = getBranchScopedWhere(req.query?.branch_id);

  const departmentMemberIds = async (where: Prisma.departmentWhereInput) => {
    const [single, positions] = await Promise.all([
      prisma.user_departments.findMany({
        where: { department_info: where },
        select: { user_id: true },
      }),
      prisma.department_positions.findMany({
        where: { department: where },
        select: { user_id: true },
      }),
    ]);
    return Array.from(new Set([...single, ...positions].map((row) => row.user_id)));
  };

  const filters: Prisma.userWhereInput[] = [activeMemberWhere];
  if (branchWhere) filters.push(branchWhere);
  if (departmentId) {
    filters.push({ id: { in: await departmentMemberIds({ id: departmentId }) } });
  }
  if (q) {
    const byDepartment = await departmentMemberIds({ name: { contains: q } });
    filters.push({ OR: [{ name: { contains: q } }, { id: { in: byDepartment } }] });
  }
  const where: Prisma.userWhereInput = { AND: filters };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * take,
      take,
      select: { id: true, name: true, is_user: true, position_id: true },
    }),
  ]);

  const userIds = users.map((user) => user.id);
  const [userDepartments, departmentPositions, headedDepartments] = userIds.length
    ? await Promise.all([
        prisma.user_departments.findMany({
          where: { user_id: { in: userIds } },
          select: { user_id: true, department_info: { select: { id: true, name: true } } },
        }),
        prisma.department_positions.findMany({
          where: { user_id: { in: userIds } },
          orderBy: { id: "asc" },
          select: {
            user_id: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        }),
        prisma.department.findMany({
          where: { department_head: { in: userIds } },
          select: { id: true, name: true, department_head: true },
        }),
      ])
    : [[], [], []];

  const positionIds = users
    .map((user) => user.position_id)
    .filter((id): id is number => Boolean(id));
  const primaryPositions = positionIds.length
    ? await prisma.position.findMany({
        where: { id: { in: positionIds } },
        select: { id: true, name: true },
      })
    : [];
  const positionById = new Map(primaryPositions.map((position) => [position.id, position]));
  const departmentByUser = new Map(
    userDepartments.map((row) => [row.user_id, row.department_info]),
  );

  const items = users.map((user) => {
    const rows = departmentPositions.filter((row) => row.user_id === user.id);
    const headOf = headedDepartments
      .filter((department) => department.department_head === user.id)
      .map((department) => ({ id: department.id, name: department.name }));
    const departments = [
      ...new Map(
        [departmentByUser.get(user.id), ...rows.map((row) => row.department)]
          .filter((entry): entry is { id: number; name: string } => Boolean(entry))
          .map((entry) => [entry.id, entry]),
      ).values(),
    ];
    return {
      id: user.id,
      name: user.name,
      ministry_worker: Boolean(user.is_user),
      department: departments[0] ?? null,
      departments,
      position:
        (user.position_id ? positionById.get(user.position_id) : null)
        ?? rows.find((row) => row.position)?.position
        ?? null,
      head_of_departments: headOf,
    };
  });

  return res.status(200).json({
    message: "Success",
    data: {
      items,
      page,
      take,
      total,
      total_pages: Math.max(1, Math.ceil(total / take)),
    },
  });
};

/**
 * GET /user/directory/departments?branch_id=
 * Every department (open or closed) with its head's name and active member
 * count — unlike `department-join-request/open-departments`, which only lists
 * departments currently accepting join requests.
 */
export const listDirectoryDepartments = async (req: Request, res: Response) => {
  const branchWhere = getBranchScopedWhere(req.query?.branch_id);
  const departments = await prisma.department.findMany({
    where: branchWhere ?? {},
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      department_head_info: { select: { id: true, name: true } },
    },
  });

  const departmentIds = departments.map((department) => department.id);
  const [single, positions] = departmentIds.length
    ? await Promise.all([
        prisma.user_departments.findMany({
          where: { department_id: { in: departmentIds }, user: activeMemberWhere },
          select: { user_id: true, department_id: true },
        }),
        prisma.department_positions.findMany({
          where: { department_id: { in: departmentIds }, user: activeMemberWhere },
          select: { user_id: true, department_id: true },
        }),
      ])
    : [[], []];
  const membersByDepartment = new Map<number, Set<number>>();
  for (const row of [...single, ...positions]) {
    if (!row.department_id) continue;
    const members = membersByDepartment.get(row.department_id) ?? new Set<number>();
    members.add(row.user_id);
    membersByDepartment.set(row.department_id, members);
  }

  return res.status(200).json({
    message: "Success",
    data: departments.map((department) => ({
      ...department,
      member_count: membersByDepartment.get(department.id)?.size ?? 0,
    })),
  });
};
