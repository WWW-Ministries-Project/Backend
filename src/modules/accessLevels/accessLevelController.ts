import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { sessionChanged, usersWithAccessLevel } from "../realtime/realtimeSession";
import { getBranchScope } from "../branches/branchScope";
import { BranchAccessError } from "../branches/branchService";
import {
  assertCanGrantInBranches,
  listBranchGrantsByUser,
  listUserBranchGrants,
  resolveGrantBranchIds,
  setBranchGrants,
  syncLegacyAccessLevel,
} from "./branchAccessService";
import { normalizeWorkspaces, resolveWorkspaces } from "../workspaces/workspaceKeys";

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
  "Giving",
  "Pledges",
  "Marketplace",
  "School_of_ministry",
  "Settings",
  // Kept so access levels saved before Community replaced Announcements
  // still validate; the dashboard now edits Community instead.
  "Announcements",
  "Community",
  "Sermons",
  "Promotions",
  "Messaging",
  "Membership_Management",
  "AI",
];

const ALLOWED_SCOPE_VALUES = new Set(["assigned_departments"]);

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
  Giving: "Giving",
  Giving_Options: "Giving",
  "Giving Options": "Giving",
  Pledges: "Pledges",
  Pledge: "Pledges",
  Marketplace: "Marketplace",
  School_of_ministry: "School_of_ministry",
  "School of ministry": "School_of_ministry",
  Settings: "Settings",
  Announcements: "Announcements",
  Announcement: "Announcements",
  Community: "Community",
  Sermons: "Sermons",
  Sermon: "Sermons",
  Promotions: "Promotions",
  Promotion: "Promotions",
  Messaging: "Messaging",
  Membership_Management: "Membership_Management",
  "Membership Management": "Membership_Management",
  AI: "AI",
};

const ALLOWED_PERMISSION_KEYS = [
  ...REQUIRED_PERMISSION_KEYS,
  ...OPTIONAL_PERMISSION_KEYS,
];

const SCOPE_SUPPORTED_PERMISSION_KEYS = [
  "Departments",
  "Church_Attendance",
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
      ...resolveWorkspaces(row?.workspaces, parsedPermissions || row?.permissions),
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

const normalizeScopes = (payload: any) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const normalizedKey =
      PERMISSION_KEY_NORMALIZER[String(rawKey).trim()] || String(rawKey).trim();
    if (!SCOPE_SUPPORTED_PERMISSION_KEYS.includes(normalizedKey)) {
      continue;
    }

    if (
      typeof rawValue !== "string" ||
      !ALLOWED_SCOPE_VALUES.has(String(rawValue))
    ) {
      return null;
    }

    normalized[normalizedKey] = String(rawValue);
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
  const scopePayload =
    payload?.Scopes ||
    payload?.scopes ||
    payload?.scope_list ||
    payload?.scopeList;

  if (exclusionPayload !== undefined) {
    const normalizedExclusions = normalizeExclusions(exclusionPayload);
    if (!normalizedExclusions) {
      return null;
    }
    normalized.Exclusions = normalizedExclusions;
  }

  if (scopePayload !== undefined) {
    const normalizedScopes = normalizeScopes(scopePayload);
    if (!normalizedScopes) {
      return null;
    }
    normalized.Scopes = normalizedScopes;
  }

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    if (
      [
        "Exclusions",
        "exclusions",
        "exclusion_list",
        "exclusionList",
        "Scopes",
        "scopes",
        "scope_list",
        "scopeList",
      ].includes(String(rawKey))
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

/**
 * Replaces `users_assigned` (the legacy single-role column) with the people who
 * hold the role through a branch grant, limited to the caller's branch scope,
 * and adds `grants` so clients can show which branch each person has it in.
 */
const attachBranchGrants = async (payload: any) => {
  const levels = (Array.isArray(payload) ? payload : [payload]).filter(Boolean);
  if (!levels.length) return payload;

  const scope = getBranchScope();
  const branchFilter = scope?.activeBranchId
    ? { branch_id: scope.activeBranchId }
    : scope?.allowedBranchIds
      ? { branch_id: { in: scope.allowedBranchIds } }
      : {};

  const grants = await prisma.user_branch_access.findMany({
    where: {
      access_level_id: { in: levels.map((level: any) => level.id) },
      ...branchFilter,
    },
    orderBy: [{ branch_id: "asc" }, { user_id: "asc" }],
    select: {
      access_level_id: true,
      branch_id: true,
      branch: { select: { name: true } },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          is_active: true,
          user_info: { select: { photo: true } },
        },
      },
    },
  });

  for (const level of levels) {
    const levelGrants = grants.filter(
      (grant) => grant.access_level_id === level.id,
    );
    level.grants = levelGrants.map((grant) => ({
      user_id: grant.user.id,
      name: grant.user.name,
      email: grant.user.email,
      is_active: grant.user.is_active !== false,
      photo: grant.user.user_info?.photo ?? null,
      branch_id: grant.branch_id,
      branch_name: grant.branch?.name ?? "",
    }));
    const seen = new Set<number>();
    level.users_assigned = levelGrants
      .filter((grant) => !seen.has(grant.user.id) && seen.add(grant.user.id))
      .map((grant) => ({
        id: grant.user.id,
        name: grant.user.name,
        user_info: { photo: grant.user.user_info?.photo ?? null },
      }));
  }

  return payload;
};

const INVALID_WORKSPACES_MESSAGE =
  "workspaces must be an array of: prelate, admin, finance, hod, generic.";

/**
 * Reads an optional `workspaces` body field. `undefined` = leave unchanged,
 * `null` = invalid (400), otherwise the canonical list to store.
 */
const parseWorkspacesInput = (value: unknown) =>
  value === undefined ? undefined : normalizeWorkspaces(value);

const branchErrorResponse = (res: Response, error: unknown) =>
  error instanceof BranchAccessError
    ? res.status(403).json({ message: error.message, data: null, code: "BRANCH_FORBIDDEN" })
    : null;

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
    const workspaces = parseWorkspacesInput(req.body?.workspaces);
    if (workspaces === null) {
      return res.status(400).json({ message: INVALID_WORKSPACES_MESSAGE, data: null });
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
        name,
        description,
        created_by,
        permissions: JSON.stringify(normalizedPermissions),
        ...(workspaces ? { workspaces } : {}),
        updated_at: new Date(),
      },
    });

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      const userIds = assigned_users.map((id: any) => Number(id));
      const branchIds = await resolveGrantBranchIds(
        toPositiveInt(req.body?.branch_id),
      );
      assertCanGrantInBranches(branchIds);
      await setBranchGrants(userIds, branchIds, response.id);
      void sessionChanged(userIds, ["permissions"]);
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
        workspaces: true,
        created_at: true,
        updated_at: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    const enrichedData = await attachBranchGrants(
      await enrichAccessLevelWithExclusions(data),
    );

    res
      .status(200)
      .json({ message: "Access Level Created Succesfully", data: enrichedData });
  } catch (error: any) {
    if (branchErrorResponse(res, error)) return;
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
    const workspaces = parseWorkspacesInput(req.body?.workspaces);
    if (workspaces === null) {
      return res.status(400).json({ message: INVALID_WORKSPACES_MESSAGE, data: null });
    }

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
        name: name ? name : undefined,
        description,
        created_by,
        permissions: permissionsForUpdate,
        workspaces,
        updated_at: new Date(),
        updated_by: toPositiveInt((req as any).user?.id) ?? undefined,
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        workspaces: true,
        created_at: true,
        updated_at: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (Array.isArray(assigned_users) && assigned_users.length > 0) {
      const branchIds = await resolveGrantBranchIds(
        toPositiveInt(req.body?.branch_id),
      );
      assertCanGrantInBranches(branchIds);
      await setBranchGrants(
        assigned_users.map((userId: any) => Number(userId)),
        branchIds,
        response.id,
      );
    }
    // Permissions changed for every holder, not only newly assigned users.
    void usersWithAccessLevel(response.id)
      .then((holders) => sessionChanged(holders, ["permissions"]))
      .catch(() => undefined);
    const enrichedResponse = await attachBranchGrants(
      await enrichAccessLevelWithExclusions(response),
    );
    res
      .status(200)
      .json({ message: "Access Level updated Succesfully", data: enrichedResponse });
  } catch (error: any) {
    if (branchErrorResponse(res, error)) return;
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error.message });
  }
};

/** PUT access/access-level-workspaces — saves only the role's Home workspaces. */
export const updateAccessLevelWorkspaces = async (req: Request, res: Response) => {
  const id = toPositiveInt(req.body?.id ?? req.query?.id);
  if (!id) {
    return res.status(400).json({ message: "A valid access level id is required.", data: null });
  }
  const workspaces = normalizeWorkspaces(req.body?.workspaces);
  if (!workspaces) {
    return res.status(400).json({ message: INVALID_WORKSPACES_MESSAGE, data: null });
  }
  const existing = await prisma.access_level.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ message: "Access level not found", data: null });
  }
  await prisma.access_level.update({
    where: { id },
    data: {
      workspaces,
      updated_at: new Date(),
      updated_by: toPositiveInt((req as any).user?.id) ?? undefined,
    },
  });
  void usersWithAccessLevel(id)
    .then((holders) => sessionChanged(holders, ["permissions"]))
    .catch(() => undefined);
  return res.status(200).json({
    message: "Operation successful",
    data: { id, workspaces, workspaces_default: false },
  });
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
        workspaces: true,
        created_at: true,
        updated_at: true,
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
    const enrichedData = await attachBranchGrants(
      await enrichAccessLevelWithExclusions(data),
    );
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
        workspaces: true,
        created_at: true,
        updated_at: true,
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
    const enrichedData = await attachBranchGrants(
      await enrichAccessLevelWithExclusions(data),
    );
    res.status(200).json({ message: "Operation successful", data: enrichedData });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const assignAccessLevelToUser = async (req: Request, res: Response) => {
  const { user_id, access_level_id, branch_id } = req.body;
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

    const branchIds = await resolveGrantBranchIds(toPositiveInt(branch_id));
    assertCanGrantInBranches(branchIds);
    await setBranchGrants([userId], branchIds, accessLevelId);

    void sessionChanged([userId], ["permissions"]);
    return res.status(200).json({
      message: "Operation successful",
      data: { branch_access: await listUserBranchGrants(userId) },
    });
  } catch (error: any) {
    if (branchErrorResponse(res, error)) return;
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

const ACCESS_LEVEL_DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  created_at: true,
  updated_at: true,
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
} as const;

const parseUserIdList = (value: unknown): number[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const ids = value.map((id) => toPositiveInt(id));
  if (ids.some((id) => id === null)) return null;

  return Array.from(new Set(ids as number[]));
};

export const listAssignableUsers = async (req: Request, res: Response) => {
  try {
    // Settings > Users also lists deactivated accounts.
    const includeInactive = String(req.query?.include_inactive ?? "") === "true";
    const users = await prisma.user.findMany({
      where: {
        is_user: true,
        ...(!includeInactive && { OR: [{ is_active: true }, { is_active: null }] }),
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        email: true,
        member_id: true,
        is_active: true,
        branch_id: true,
        last_active_at: true,
        branch: { select: { name: true } },
        user_info: {
          select: {
            first_name: true,
            last_name: true,
            photo: true,
          },
        },
        access: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const grantsByUser = await listBranchGrantsByUser(users.map((user) => user.id));
    const data = users.map((user) => ({
      id: user.id,
      name: buildFullName(user) || user.name,
      email: user.email,
      member_id: user.member_id,
      photo: user.user_info?.photo || null,
      access_level: user.access
        ? { id: user.access.id, name: user.access.name }
        : null,
      branch_access: grantsByUser.get(user.id) ?? [],
      is_active: user.is_active !== false,
      home_branch_id: user.branch_id,
      home_branch_name: user.branch?.name ?? null,
      last_active_at: user.last_active_at,
    }));

    return res.status(200).json({ message: "Operation successful", data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const bulkAssignAccessLevel = async (req: Request, res: Response) => {
  const { access_level_id, assign_user_ids, unassign_user_ids } = req.body;
  try {
    const accessLevelId = toPositiveInt(access_level_id);
    if (!accessLevelId) {
      return res.status(400).json({
        message: "Invalid access_level_id.",
        data: null,
      });
    }

    const assignIds = parseUserIdList(assign_user_ids);
    const unassignIds = parseUserIdList(unassign_user_ids);
    if (!assignIds || !unassignIds) {
      return res.status(400).json({
        message:
          "assign_user_ids and unassign_user_ids must be arrays of user ids.",
        data: null,
      });
    }

    if (assignIds.length === 0 && unassignIds.length === 0) {
      return res.status(400).json({
        message: "Provide at least one user to assign or unassign.",
        data: null,
      });
    }

    const unassignSet = new Set(unassignIds);
    const conflictingIds = assignIds.filter((id) => unassignSet.has(id));
    if (conflictingIds.length > 0) {
      return res.status(400).json({
        message: "A user cannot be assigned and unassigned in the same request.",
        data: { conflicting_user_ids: conflictingIds },
      });
    }

    const accessLevel = await prisma.access_level.findUnique({
      where: { id: accessLevelId },
      select: { id: true, deleted: true },
    });
    if (!accessLevel || accessLevel.deleted) {
      return res.status(404).json({
        message: "Access level not found",
        data: null,
      });
    }

    if (assignIds.length > 0) {
      const { invalidUserIds, nonMinistryWorkerIds } =
        await validateAssignableUsers(assignIds);
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

    const branchIds = await resolveGrantBranchIds(
      toPositiveInt(req.body?.branch_id),
    );
    assertCanGrantInBranches(branchIds);

    await setBranchGrants(assignIds, branchIds, accessLevelId);
    // Only remove grants that are actually on this level, so a stale client
    // cannot strip someone who has since moved to another level.
    const unassigned = await prisma.user_branch_access.deleteMany({
      where: {
        user_id: { in: unassignIds },
        branch_id: { in: branchIds },
        access_level_id: accessLevelId,
      },
    });
    await syncLegacyAccessLevel(unassignIds);
    const assigned = { count: assignIds.length };
    void sessionChanged([...assignIds, ...unassignIds], ["permissions"]);

    const updated = await prisma.access_level.findUnique({
      where: { id: accessLevelId },
      select: ACCESS_LEVEL_DETAIL_SELECT,
    });
    const enriched = await attachBranchGrants(
      await enrichAccessLevelWithExclusions(updated),
    );

    return res.status(200).json({
      message: "Access level members updated successfully",
      data: {
        access_level: enriched,
        assigned_count: assigned.count,
        unassigned_count: unassigned.count,
      },
    });
  } catch (error: any) {
    if (branchErrorResponse(res, error)) return;
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
    const holders = await usersWithAccessLevel(Number(id));
    // Optionally move everyone holding this role to another one first, so
    // nobody is left without access.
    const reassignTo = toPositiveInt(req.query?.reassign_to);
    if (reassignTo && reassignTo !== Number(id)) {
      const target = await prisma.access_level.findFirst({
        where: { id: reassignTo, deleted: false },
        select: { id: true },
      });
      if (!target) {
        return res
          .status(400)
          .json({ message: "The role to move people to doesn't exist", data: null });
      }
      await prisma.$transaction([
        prisma.user_branch_access.updateMany({
          where: { access_level_id: Number(id) },
          data: { access_level_id: reassignTo },
        }),
        prisma.user.updateMany({
          where: { access_level_id: Number(id) },
          data: { access_level_id: reassignTo },
        }),
      ]);
    }
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
    // Their grants for this role were removed with it; point the legacy
    // column at whatever roles they still hold.
    await syncLegacyAccessLevel(holders);
    void sessionChanged(holders, ["permissions"]);
    listAllAccessLevel(req, res);
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

/** GET /access/user-branch-access?user_id= — a user's role in each branch. */
export const getUserBranchAccess = async (req: Request, res: Response) => {
  const userId = toPositiveInt(req.query?.user_id);
  if (!userId) {
    return res.status(400).json({ message: "Invalid user_id.", data: null });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, is_user: true, branch_id: true },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found", data: null });
    }
    return res.status(200).json({
      message: "Operation successful",
      data: {
        user_id: user.id,
        home_branch_id: user.branch_id ?? null,
        branch_access: await listUserBranchGrants(user.id),
      },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

/**
 * PUT /access/user-branch-access — set a user's role in one branch.
 * Body: `{ user_id, branch_id, access_level_id }`; `access_level_id: null`
 * removes their access to that branch (their other branches stay).
 */
export const setUserBranchAccess = async (req: Request, res: Response) => {
  const userId = toPositiveInt(req.body?.user_id);
  const branchId = toPositiveInt(req.body?.branch_id);
  const rawLevel = req.body?.access_level_id;
  const removing = rawLevel === null || rawLevel === "";
  const accessLevelId = removing ? null : toPositiveInt(rawLevel);

  if (!userId || !branchId || (!removing && !accessLevelId)) {
    return res.status(400).json({
      message: "user_id, branch_id and access_level_id (or null) are required.",
      data: null,
    });
  }

  try {
    assertCanGrantInBranches([branchId]);

    const [user, branch, accessLevel] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, is_user: true },
      }),
      prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }),
      accessLevelId
        ? prisma.access_level.findUnique({
            where: { id: accessLevelId },
            select: { id: true, deleted: true },
          })
        : Promise.resolve(null),
    ]);

    if (!user) {
      return res.status(404).json({ message: "User not found", data: null });
    }
    if (!branch) {
      return res.status(404).json({ message: "Branch not found", data: null });
    }
    if (accessLevelId && !user.is_user) {
      return res.status(400).json({
        message: "Only ministry workers can be assigned access levels.",
        data: null,
      });
    }
    if (accessLevelId && (!accessLevel || accessLevel.deleted)) {
      return res.status(404).json({ message: "Access level not found", data: null });
    }

    await setBranchGrants([userId], [branchId], accessLevelId);
    void sessionChanged([userId], ["permissions"]);

    return res.status(200).json({
      message: "Operation successful",
      data: {
        user_id: userId,
        branch_access: await listUserBranchGrants(userId),
      },
    });
  } catch (error: any) {
    if (branchErrorResponse(res, error)) return;
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};
