import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { toCapitalizeEachWord } from "../../utils";

const ALLOWED_PERMISSION_VALUES = new Set([
  "Can_View",
  "Can_Manage",
  "Super_Admin",
  "No_Access",
]);

const REQUIRED_PERMISSION_KEYS = [
  "Members",
  "Departments",
  "Positions",
  "Access_rights",
  "Asset",
  "Events",
  "Requisition",
  "Program",
  "Life Center",
];

const OPTIONAL_PERMISSION_KEYS = [
  "Visitors",
  "Appointments",
  "Church_Attendance",
  "Theme",
  "Financials",
  "Marketplace",
  "School_of_ministry",
  "Settings",
];

const PERMISSION_KEY_NORMALIZER: Record<string, string> = {
  Members: "Members",
  Departments: "Departments",
  Positions: "Positions",
  Access_rights: "Access_rights",
  "Access rights": "Access_rights",
  Asset: "Asset",
  Events: "Events",
  Requisition: "Requisition",
  Requisitions: "Requisition",
  Program: "Program",
  "Life Center": "Life Center",
  Visitors: "Visitors",
  Appointments: "Appointments",
  "Church Attendance": "Church_Attendance",
  Church_Attendance: "Church_Attendance",
  Theme: "Theme",
  Financials: "Financials",
  Marketplace: "Marketplace",
  School_of_ministry: "School_of_ministry",
  "School of ministry": "School_of_ministry",
  Settings: "Settings",
};

const ALLOWED_PERMISSION_KEYS = [
  ...REQUIRED_PERMISSION_KEYS,
  ...OPTIONAL_PERMISSION_KEYS,
];

const toPositiveInt = (value: any) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parsePermissionsObject = (permissions: unknown): Record<string, any> | null => {
  if (!permissions) return null;

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return null;

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions);
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Record<string, any>;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  if (
    typeof permissions === "object" &&
    !Array.isArray(permissions)
  ) {
    return permissions as Record<string, any>;
  }

  return null;
};

const getExclusionSource = (permissions: any) => {
  const parsedPermissions = parsePermissionsObject(permissions);
  if (!parsedPermissions) {
    return null;
  }

  const candidates = [
    parsedPermissions.Exclusions,
    parsedPermissions.exclusions,
    parsedPermissions.exclusion_list,
    parsedPermissions.exclusionList,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
};

const normalizeExclusionMap = (permissions: any) => {
  const source = getExclusionSource(permissions);
  if (!source) return {} as Record<string, number[]>;

  const normalized: Record<string, number[]> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const normalizedKey =
      PERMISSION_KEY_NORMALIZER[String(rawKey).trim()] || String(rawKey).trim();
    if (!ALLOWED_PERMISSION_KEYS.includes(normalizedKey)) continue;
    if (!Array.isArray(rawValue)) continue;

    const ids = Array.from(
      new Set(
        rawValue
          .map((value) => toPositiveInt(value))
          .filter((value): value is number => Boolean(value)),
      ),
    );

    normalized[normalizedKey] = ids;
  }

  return normalized;
};

const buildFullName = (user: any) => {
  const firstName = String(user?.user_info?.first_name || "").trim();
  const lastName = String(user?.user_info?.last_name || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;

  const fallbackName = String(user?.name || "").trim();
  return fallbackName || null;
};

const enrichAccessLevelWithExclusions = async (payload: any) => {
  if (!payload) return payload;

  const rows = Array.isArray(payload) ? payload : [payload];
  const exclusionMaps = rows.map((row) => normalizeExclusionMap(row?.permissions));

  const allExcludedUserIds = Array.from(
    new Set(
      exclusionMaps.flatMap((map) =>
        Object.values(map).flatMap((ids) => ids),
      ),
    ),
  );

  const users = allExcludedUserIds.length
    ? await prisma.user.findMany({
        where: {
          id: { in: allExcludedUserIds },
        },
        select: {
          id: true,
          name: true,
          user_info: {
            select: {
              first_name: true,
              last_name: true,
            },
          },
        },
      })
    : [];

  const userNameMap = new Map<number, string | null>(
    users.map((user) => [user.id, buildFullName(user)]),
  );

  const enriched = rows.map((row, index) => {
    const exclusionMap = exclusionMaps[index];
    const parsedPermissions = parsePermissionsObject(row?.permissions);
    const exclusionUsers = Object.fromEntries(
      Object.entries(exclusionMap).map(([domainKey, ids]) => [
        domainKey,
        ids.map((userId) => ({
          id: userId,
          full_name: userNameMap.get(userId) || null,
        })),
      ]),
    );

    return {
      ...row,
      permissions: parsedPermissions || row?.permissions,
      exclusion_users: exclusionUsers,
    };
  });

  return Array.isArray(payload) ? enriched : enriched[0];
};

const normalizeExclusions = (payload: any) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const normalized: Record<string, number[]> = {};
  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const normalizedKey =
      PERMISSION_KEY_NORMALIZER[String(rawKey).trim()] || String(rawKey).trim();
    if (!ALLOWED_PERMISSION_KEYS.includes(normalizedKey)) {
      continue;
    }

    if (!Array.isArray(rawValue)) {
      return null;
    }

    const ids = Array.from(
      new Set(
        rawValue
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );

    if (ids.length !== rawValue.length) {
      return null;
    }

    normalized[normalizedKey] = ids;
  }

  return normalized;
};

const normalizePermissionPayload = (payload: any) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const normalized: Record<string, any> = {};
  const exclusionPayload =
    payload?.Exclusions ||
    payload?.exclusions ||
    payload?.exclusion_list ||
    payload?.exclusionList;

  if (exclusionPayload !== undefined) {
    const normalizedExclusions = normalizeExclusions(exclusionPayload);
    if (!normalizedExclusions) {
      return null;
    }
    normalized.Exclusions = normalizedExclusions;
  }

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    if (
      ["Exclusions", "exclusions", "exclusion_list", "exclusionList"].includes(
        String(rawKey),
      )
    ) {
      continue;
    }

    const normalizedKey =
      PERMISSION_KEY_NORMALIZER[String(rawKey).trim()] || String(rawKey).trim();

    if (!ALLOWED_PERMISSION_KEYS.includes(normalizedKey)) {
      continue;
    }

    if (
      typeof rawValue !== "string" ||
      !ALLOWED_PERMISSION_VALUES.has(String(rawValue))
    ) {
      return null;
    }

    normalized[normalizedKey] = String(rawValue);
  }

  const hasAllKeys = REQUIRED_PERMISSION_KEYS.every((key) => normalized[key]);
  return hasAllKeys ? normalized : null;
};

const validateAssignableUsers = async (assignedUsers: number[]) => {
  const users = await prisma.user.findMany({
    where: {
      id: { in: assignedUsers },
    },
    select: {
      id: true,
      is_user: true,
    },
  });

  const userMap = new Map(users.map((user) => [user.id, user]));
  const invalidUserIds = assignedUsers.filter((id) => !userMap.has(id));
  const nonMinistryWorkerIds = users
    .filter((user) => !user.is_user)
    .map((user) => user.id);

  return {
    invalidUserIds,
    nonMinistryWorkerIds,
  };
};

// Access Levels Controllers
export const createAccessLevel = async (req: Request, res: Response) => {
  const { name, description, permissions, created_by, assigned_users } =
    req.body;
  try {
    const normalizedPermissions = normalizePermissionPayload(permissions);
    if (!normalizedPermissions) {
      return res.status(400).json({
        message:
          "Invalid permissions payload. Ensure all permission keys are present with valid access levels.",
        data: null,
      });
    }

    if (assigned_users !== undefined && !Array.isArray(assigned_users)) {
      return res.status(400).json({
        message: "assigned_users must be an array of user ids.",
        data: null,
      });
    }

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      const assignedUserIds = assigned_users
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (assignedUserIds.length !== assigned_users.length) {
        return res.status(400).json({
          message: "assigned_users contains invalid user ids.",
          data: null,
        });
      }

      const { invalidUserIds, nonMinistryWorkerIds } =
        await validateAssignableUsers(assignedUserIds);
      if (invalidUserIds.length > 0 || nonMinistryWorkerIds.length > 0) {
        return res.status(400).json({
          message:
            "Only existing ministry workers can be assigned access levels.",
          data: {
            invalid_user_ids: invalidUserIds,
            non_ministry_worker_ids: nonMinistryWorkerIds,
          },
        });
      }
    }

    const response = await prisma.access_level.create({
      data: {
        name: toCapitalizeEachWord(name),
        description,
        created_by,
        permissions: JSON.stringify(normalizedPermissions),
      },
    });

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      await prisma.user.updateMany({
        where: {
          id: {
            in: assigned_users.map((id: any) => Number(id)),
          },
          is_user: true,
        },
        data: {
          access_level_id: response.id,
        },
      });
    }

    const data = await prisma.access_level.findMany({
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    const enrichedData = await enrichAccessLevelWithExclusions(data);

    res
      .status(200)
      .json({ message: "Access Level Created Succesfully", data: enrichedData });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error.message });
  }
};

export const updateAccessLevel = async (req: Request, res: Response) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({
      message: "Operation successful",
      data: "Missing ID for the access level",
    });
  }
  const { name, description, permissions, created_by, assigned_users } =
    req.body;
  try {
    const normalizedPermissions =
      permissions === undefined
        ? undefined
        : normalizePermissionPayload(permissions);
    if (permissions !== undefined && !normalizedPermissions) {
      return res.status(400).json({
        message:
          "Invalid permissions payload. Ensure all permission keys are present with valid access levels.",
        data: null,
      });
    }
    const permissionsForUpdate = normalizedPermissions
      ? JSON.stringify(normalizedPermissions)
      : undefined;

    if (assigned_users !== undefined && !Array.isArray(assigned_users)) {
      return res.status(400).json({
        message: "assigned_users must be an array of user ids.",
        data: null,
      });
    }

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      const assignedUserIds = assigned_users
        .map((userId: any) => Number(userId))
        .filter((userId: number) => Number.isInteger(userId) && userId > 0);

      if (assignedUserIds.length !== assigned_users.length) {
        return res.status(400).json({
          message: "assigned_users contains invalid user ids.",
          data: null,
        });
      }

      const { invalidUserIds, nonMinistryWorkerIds } =
        await validateAssignableUsers(assignedUserIds);
      if (invalidUserIds.length > 0 || nonMinistryWorkerIds.length > 0) {
        return res.status(400).json({
          message:
            "Only existing ministry workers can be assigned access levels.",
          data: {
            invalid_user_ids: invalidUserIds,
            non_ministry_worker_ids: nonMinistryWorkerIds,
          },
        });
      }
    }

    const response = await prisma.access_level.update({
      where: {
        id: Number(id),
      },
      data: {
        name: name ? toCapitalizeEachWord(name) : undefined,
        description,
        created_by,
        permissions: permissionsForUpdate,
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      await prisma.user.updateMany({
        where: {
          id: {
            in: assigned_users.map((userId: any) => Number(userId)),
          },
          is_user: true,
        },
        data: {
          access_level_id: response.id,
        },
      });
    }
    const enrichedResponse = await enrichAccessLevelWithExclusions(response);
    res
      .status(200)
      .json({ message: "Access Level updated Succesfully", data: enrichedResponse });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error.message });
  }
};

export const listAllAccessLevel = async (req: Request, res: Response) => {
  try {
    const data = await prisma.access_level.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
            user_info: {
              select: {
                photo: true,
              },
            },
          },
        },
      },
    });
    const enrichedData = await enrichAccessLevelWithExclusions(data);
    res.status(200).json({ message: "Operation successful", data: enrichedData });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const getAccessLevel = async (req: Request, res: Response) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({
      message: "Operation successful",
      data: "Missing ID for the access level",
    });
  }
  try {
    const data = await prisma.access_level.findFirst({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
            user_info: {
              select: {
                photo: true,
              },
            },
          },
        },
      },
    });
    const enrichedData = await enrichAccessLevelWithExclusions(data);
    res.status(200).json({ message: "Operation successful", data: enrichedData });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const assignAccessLevelToUser = async (req: Request, res: Response) => {
  const { user_id, access_level_id } = req.body;
  try {
    const userId = Number(user_id);
    const accessLevelId = Number(access_level_id);

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(accessLevelId) ||
      accessLevelId <= 0
    ) {
      return res.status(400).json({
        message: "Invalid user_id or access_level_id.",
        data: null,
      });
    }

    const [targetUser, accessLevel] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, is_user: true },
      }),
      prisma.access_level.findUnique({
        where: { id: accessLevelId },
        select: { id: true, deleted: true },
      }),
    ]);

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
        data: null,
      });
    }

    if (!targetUser.is_user) {
      return res.status(400).json({
        message: "Only ministry workers can be assigned access levels.",
        data: null,
      });
    }

    if (!accessLevel || accessLevel.deleted) {
      return res.status(404).json({
        message: "Access level not found",
        data: null,
      });
    }

    const assign = await prisma.user.update({
      where: { id: userId },
      data: { access_level_id: accessLevelId },
    });

    if (!assign) {
      return res.status(500).json({ message: "Invalid User Id" });
    }

    return res.status(200).json({ message: "Operation successful" });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const deleteAccessLevel = async (req: Request, res: Response) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({
      message: "Operation successful",
      data: "Missing ID for the access level",
    });
  }
  try {
    const unAssign = await prisma.user.updateMany({
      where: {
        access_level_id: Number(id),
      },
      data: {
        access_level_id: null,
      },
    });
    const deleteAccess = await prisma.access_level.delete({
      where: { id: Number(id) },
    });
    if (!deleteAccess) {
      res.status(500).json({ message: "Invalid Access Level Id" });
    }
    listAllAccessLevel(req, res);
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};
