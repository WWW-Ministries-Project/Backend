import { hasActionPermission, resolveDomainScope } from "../../middleWare/authorization";

/**
 * Home workspaces an access level can turn on, in display order.
 * Contract: Frontend/docs/WORKSPACES_AND_REPORT_CONFIG_BACKEND_CONTRACT.md
 */
export const WORKSPACE_KEYS = ["prelate", "admin", "finance", "hod", "generic"] as const;
export type WorkspaceKey = (typeof WORKSPACE_KEYS)[number];

export const isWorkspaceKey = (value: unknown): value is WorkspaceKey =>
  typeof value === "string" && (WORKSPACE_KEYS as readonly string[]).includes(value);

/** Drops duplicates and returns the keys in canonical order. Returns null when any key is unknown. */
export const normalizeWorkspaces = (value: unknown): WorkspaceKey[] | null => {
  if (!Array.isArray(value)) return null;
  if (!value.every(isWorkspaceKey)) return null;
  const picked = new Set(value as WorkspaceKey[]);
  return WORKSPACE_KEYS.filter((key) => picked.has(key));
};

/** Default for a role that never had workspaces saved, worked out from its permissions. */
export const deriveDefaultWorkspaces = (permissions: unknown): WorkspaceKey[] => {
  const out = new Set<WorkspaceKey>();
  if (hasActionPermission(permissions, "Reports", "admin")) out.add("prelate");
  if (hasActionPermission(permissions, "Settings", "manage") || hasActionPermission(permissions, "Members", "manage")) {
    out.add("admin");
  }
  if (hasActionPermission(permissions, "Financials", "manage")) out.add("finance");
  if (
    hasActionPermission(permissions, "Departments", "manage") &&
    resolveDomainScope(permissions, "Departments") === "assigned_departments"
  ) {
    out.add("hod");
  }
  if (!out.size) out.add("generic");
  return WORKSPACE_KEYS.filter((key) => out.has(key));
};

/** Stored workspaces when set (an empty array means Home only), else the derived default. */
export const resolveWorkspaces = (stored: unknown, permissions: unknown) => {
  const parsed = normalizeWorkspaces(stored);
  return parsed
    ? { workspaces: parsed, workspaces_default: false }
    : { workspaces: deriveDefaultWorkspaces(permissions), workspaces_default: true };
};
