const PERMISSION_KEY_ALIASES: Record<string, string[]> = {
  Financials: ["Financials", "Finance", "Finances"],
};

const ACCESS_LEVEL_RANK: Record<string, number> = {
  No_Access: 0,
  Can_View: 1,
  Can_Manage: 2,
  Super_Admin: 3,
};

export type MinimumAccessLevel = "view" | "manage" | "admin";

const MINIMUM_ACCESS_RANK: Record<MinimumAccessLevel, number> = {
  view: ACCESS_LEVEL_RANK.Can_View,
  manage: ACCESS_LEVEL_RANK.Can_Manage,
  admin: ACCESS_LEVEL_RANK.Super_Admin,
};

export const parsePermissionsObject = (
  permissions: unknown,
): Record<string, unknown> => {
  if (!permissions) return {};

  if (typeof permissions === "string") {
    const trimmedPermissions = permissions.trim();
    if (!trimmedPermissions) return {};

    try {
      const parsedPermissions = JSON.parse(trimmedPermissions);
      if (
        parsedPermissions &&
        typeof parsedPermissions === "object" &&
        !Array.isArray(parsedPermissions)
      ) {
        return parsedPermissions as Record<string, unknown>;
      }
    } catch (error) {
      return {};
    }

    return {};
  }

  if (typeof permissions === "object" && !Array.isArray(permissions)) {
    return permissions as Record<string, unknown>;
  }

  return {};
};

export const resolvePermissionValue = (
  permissions: unknown,
  permissionType: string,
): string | null => {
  const parsedPermissions = parsePermissionsObject(permissions);
  const aliasKeys = PERMISSION_KEY_ALIASES[permissionType] || [permissionType];

  for (const key of aliasKeys) {
    const value = parsedPermissions[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

export const userHasMinimumDomainAccess = (
  permissions: unknown,
  permissionType: string,
  minimumAccess: MinimumAccessLevel,
): boolean => {
  const permissionValue = resolvePermissionValue(permissions, permissionType);
  if (!permissionValue) return false;

  const actualRank = ACCESS_LEVEL_RANK[permissionValue] ?? 0;
  return actualRank >= MINIMUM_ACCESS_RANK[minimumAccess];
};
