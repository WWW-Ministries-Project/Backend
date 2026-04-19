import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { departmentSchema, toCapitalizeEachWord } from "../../utils";
import {
  buildRoleEligibilityFailureResponse,
  isRoleEligibilityValidationError,
  roleEligibilityService,
} from "../settings/roleEligibilityService";

const toPositiveInt = (value: unknown) => {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
};

const DEFAULT_DEPARTMENT_MEMBER_PAGE = 1;
const DEFAULT_DEPARTMENT_MEMBER_PAGE_SIZE = 12;

type DepartmentScope = {
  mode: "all" | "assigned";
  departmentIds: number[];
};

const getDepartmentScope = (req: Request): DepartmentScope => {
  const rawScope = (req as any)?.departmentScope;
  const departmentIds = Array.isArray(rawScope?.departmentIds)
    ? rawScope.departmentIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    : [];

  if (rawScope?.mode === "assigned") {
    return {
      mode: "assigned",
      departmentIds,
    };
  }

  return {
    mode: "all",
    departmentIds: [],
  };
};

const getDepartmentScopeWhere = (req: Request) => {
  const scope = getDepartmentScope(req);

  if (scope.mode !== "assigned") {
    return undefined;
  }

  return {
    id: {
      in: scope.departmentIds,
    },
  };
};

const isDepartmentInScope = (req: Request, departmentId: number) => {
  const scope = getDepartmentScope(req);
  return scope.mode !== "assigned" || scope.departmentIds.includes(departmentId);
};

const getDepartmentMemberWhere = (
  departmentId: number,
  searchTerm?: string,
) => {
  const filters: Record<string, unknown>[] = [
    {
      OR: [
        { department_id: departmentId },
        { department_positions: { some: { department_id: departmentId } } },
      ],
    },
  ];

  const normalizedSearch = searchTerm?.trim();
  if (normalizedSearch) {
    filters.push({
      OR: [
        { name: { contains: normalizedSearch } },
        { email: { contains: normalizedSearch } },
        { member_id: { contains: normalizedSearch } },
        {
          user_info: {
            is: {
              primary_number: { contains: normalizedSearch },
            },
          },
        },
      ],
    });
  }

  return filters.length === 1 ? filters[0] : { AND: filters };
};

const mapDepartmentMemberRows = (
  users: any[],
  department: {
    id: number;
    name: string;
  },
) => {
  return users.map(({ user_info, department_positions, ...rest }) => {
    const info = user_info || {};
    const workInfo = info.work_info || null;
    const { work_info, ...flatInfo } = info;

    return {
      ...rest,
      ...flatInfo,
      department_id: department.id,
      department_name: department.name,
      department_names: [department.name],
      department_positions: (department_positions || []).map((entry: any) => ({
        department_id: entry?.department?.id ?? entry?.department_id ?? null,
        department_name: entry?.department?.name ?? null,
        position_id: entry?.position?.id ?? entry?.position_id ?? null,
        position_name: entry?.position?.name ?? null,
      })),
      marital_status: flatInfo?.marital_status ?? null,
      employment_status: workInfo?.employment_status ?? null,
      date_joined: flatInfo?.member_since ?? rest?.created_at ?? null,
    };
  });
};

const getDepartmentMemberCounts = async () => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      department_id: true,
      department_positions: {
        select: {
          department_id: true,
        },
      },
    },
  });

  const memberIdsByDepartment = new Map<number, Set<number>>();

  users.forEach((user) => {
    const departmentIds = new Set<number>();

    if (typeof user.department_id === "number") {
      departmentIds.add(user.department_id);
    }

    (user.department_positions || []).forEach((entry) => {
      if (typeof entry.department_id === "number") {
        departmentIds.add(entry.department_id);
      }
    });

    departmentIds.forEach((departmentId) => {
      const departmentMembers = memberIdsByDepartment.get(departmentId) || new Set<number>();
      departmentMembers.add(user.id);
      memberIdsByDepartment.set(departmentId, departmentMembers);
    });
  });

  return memberIdsByDepartment;
};

export const createDepartment = async (req: Request, res: Response) => {
  const { name, department_head, description, created_by } = req.body;
  departmentSchema.validate(req.body);
  try {
    if (getDepartmentScope(req).mode === "assigned") {
      return res.status(403).json({
        message: "Assigned department access cannot create new departments",
        data: null,
      });
    }

    if (!name || name.trim() === "") {
      return res.status(400).json({
        message: "Empty Department Name",
        data: null,
      });
    }

    const departmentHeadId = toPositiveInt(department_head);
    if (departmentHeadId) {
      await roleEligibilityService.assertEligible(
        "head_of_department",
        departmentHeadId,
      );
    }

    const existing = await prisma.department.findFirst({
      where: {
        name: toCapitalizeEachWord(name),
      },
    });
    if (existing) {
      return res.status(400).json({
        message: "Department Name already exist",
        data: null,
      });
    }

    await prisma.department.create({
      data: {
        name: toCapitalizeEachWord(name),
        department_head,
        description,
        created_by,
      },
    });

    const data = await prisma.department.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Department Created Succesfully", data: data });
  } catch (error: any) {
    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }

    return res
      .status(500)
      .json({ message: "Department failed to create", data: error });
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  const { id, name, department_head, description, updated_by } = req.body;

  try {
    const departmentId = toPositiveInt(id);
    if (!departmentId) {
      return res.status(400).json({
        message: "Department id is required",
        data: null,
      });
    }

    if (!isDepartmentInScope(req, departmentId)) {
      return res.status(403).json({
        message: "You do not have access to update this department",
        data: null,
      });
    }

    if (!name || name.trim() === "") {
      return res.status(400).json({
        message: "We cannot have an empty department name, you get it?",
        data: null,
      });
    }

    const departmentHeadId = toPositiveInt(department_head);
    if (departmentHeadId) {
      await roleEligibilityService.assertEligible(
        "head_of_department",
        departmentHeadId,
      );
    }

    const response = await prisma.department.update({
      where: {
        id: departmentId,
      },
      data: {
        name: toCapitalizeEachWord(name),
        department_head,
        description,
        updated_by,
        updated_at: new Date(),
        is_sync: false, //setting to to out of sync for cron job to sync to device
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Department Updated Succesfully", data: response });
  } catch (error) {
    if (isRoleEligibilityValidationError(error)) {
      return res
        .status(error.statusCode)
        .json(buildRoleEligibilityFailureResponse(error));
    }

    return res
      .status(503)
      .json({ message: "Department failed to update", data: error });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  const { id } = req.query;

  try {
    const departmentId = toPositiveInt(id);
    if (!departmentId) {
      return res.status(400).json({
        message: "Department id is required",
        data: null,
      });
    }

    if (!isDepartmentInScope(req, departmentId)) {
      return res.status(403).json({
        message: "You do not have access to delete this department",
        data: null,
      });
    }

    await prisma.department.delete({
      where: {
        id: departmentId,
      },
    });
    const data = await prisma.department.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Department Deleted Succesfully", data: data });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to delete", data: error });
  }
};

export const listDepartments = async (req: Request, res: Response) => {
  try {
    const { page = 1, take = 10 }: any = req.query;
    const departmentScopeWhere = getDepartmentScopeWhere(req);
    const total = await prisma.department.count({
      where: departmentScopeWhere,
    });

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(take, 10) || 10;
    const memberIdsByDepartment = await getDepartmentMemberCounts();

    const response = await prisma.department.findMany({
      where: departmentScopeWhere,
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
        position: {
          orderBy: {
            name: "asc",
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const data = response.map((department) => ({
      ...department,
      member_count: memberIdsByDepartment.get(department.id)?.size || 0,
    }));

    res.status(200).json({
      message: "Success",
      current_page: pageNum,
      page_size: pageSize,
      take: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
      data,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to fetch", data: error });
  }
};

export const listDepartmentsLight = async (req: Request, res: Response) => {
  try {
    const departmentScopeWhere = getDepartmentScopeWhere(req);
    const response = await prisma.department.findMany({
      where: departmentScopeWhere,
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
        position: {
          orderBy: {
            name: "asc",
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    const data = response?.map((d) => {
      const { department_head_info, position, ...rest } = d;
      return {
        ...rest,
        department_head: department_head_info?.name || "No Department Head",
        positions: position?.map((p) => p.name) || [],
      };
    });

    res.status(200).json({
      message: "Success",
      data: data,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to fetch", data: error });
  }
};

export const getDepartment = async (req: Request, res: Response) => {
  const { id, page = DEFAULT_DEPARTMENT_MEMBER_PAGE, limit, take, name } = req.query;

  try {
    const departmentId = toPositiveInt(id);
    if (!departmentId) {
      return res.status(400).json({
        message: "Department id is required",
        data: null,
      });
    }

    if (!isDepartmentInScope(req, departmentId)) {
      return res.status(403).json({
        message: "You do not have access to view this department",
        data: null,
      });
    }

    const pageNum =
      toPositiveInt(page) || DEFAULT_DEPARTMENT_MEMBER_PAGE;
    const pageSize =
      toPositiveInt(limit) ||
      toPositiveInt(take) ||
      DEFAULT_DEPARTMENT_MEMBER_PAGE_SIZE;
    const skip = (pageNum - 1) * pageSize;

    const response = await prisma.department.findUnique({
      where: {
        id: departmentId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!response) {
      return res.status(200).json({
        message: "No department found",
        current_page: pageNum,
        page_size: pageSize,
        take: pageSize,
        total: 0,
        totalPages: 0,
        data: null,
      });
    }

    const memberWhere = getDepartmentMemberWhere(
      departmentId,
      typeof name === "string" ? name : undefined,
    );

    const total = await prisma.user.count({
      where: memberWhere,
    });

    const members = await prisma.user.findMany({
      skip,
      take: pageSize,
      orderBy: {
        name: "asc",
      },
      where: memberWhere,
      select: {
        id: true,
        name: true,
        email: true,
        member_id: true,
        created_at: true,
        is_active: true,
        is_user: true,
        department_id: true,
        membership_type: true,
        status: true,
        user_info: {
          select: {
            country_code: true,
            primary_number: true,
            title: true,
            photo: true,
            country: true,
            member_since: true,
            date_of_birth: true,
            marital_status: true,
            work_info: {
              select: {
                employment_status: true,
              },
            },
          },
        },
        position: {
          select: {
            id: true,
            name: true,
          },
        },
        department_positions: {
          select: {
            department_id: true,
            position_id: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.status(200).json({
      message: "Success",
      current_page: pageNum,
      page_size: pageSize,
      take: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
      data: {
        ...response,
        member_count: total,
        members: mapDepartmentMemberRows(members, {
          id: response.id,
          name: response.name,
        }),
      },
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "No Department Found", data: error });
  }
};
