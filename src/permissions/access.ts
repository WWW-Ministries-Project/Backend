import { resolveDomainLevel } from "../middleWare/authorization";
import { PERMISSION_CATALOG, type ScopeValue } from "./catalog";

/**
 * Resolves actions and scopes on a stored permission blob
 * (`{ Domain: Level, Actions: {...}, Scopes: {...} }`). Callers pass the
 * live, active-branch permissions (`req.user.permissions` after a permission
 * guard, or the access context's), never the login token's.
 */

const LEVEL_RANK: Record<string, number> = {
  No_Access: 0,
  Can_View: 1,
  Can_Manage: 2,
  Super_Admin: 3,
};

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export const domainRank = (permissions: unknown, domain: string): number => {
  const level = resolveDomainLevel(asObject(permissions), domain);
  return typeof level === "string" ? LEVEL_RANK[level] ?? 0 : 0;
};

/**
 * Whether the role may perform `domain.action`: an explicit switch in
 * `Actions` wins; otherwise the level decides, and explicit ("on purpose")
 * actions stay off. An action the catalogue doesn't know falls back to
 * Manage, so a typo never opens something up.
 */
export const actionAllowed = (
  permissions: unknown,
  domain: string,
  action: string,
): boolean => {
  const rank = domainRank(permissions, domain);
  if (!rank) return false;
  const override = asObject(asObject(asObject(permissions).Actions)[domain])[action];
  if (typeof override === "boolean") return override;
  const entry = PERMISSION_CATALOG[domain]?.actions.find(([key]) => key === action);
  if (!entry) return rank >= LEVEL_RANK.Can_Manage;
  const [, defaultLevel, explicit] = entry;
  if (explicit && !isLegacyRole(permissions)) return false;
  return rank >= defaultLevel;
};

/**
 * A role saved before the role editor had actions (its permissions carry no
 * `Actions` key). Such a role keeps what its levels gave it before actions
 * existed: on-purpose actions follow the level like any other, and moved
 * rights (e.g. user management under Members) still use the old rule, until
 * an admin saves the role in the new editor.
 */
export const isLegacyRole = (permissions: unknown): boolean =>
  !Object.prototype.hasOwnProperty.call(asObject(permissions), "Actions");

const SCOPE_VALUES = new Set<ScopeValue>([
  "own",
  "assigned",
  "department",
  "department_member",
  "life_center",
  "branch",
]);

/**
 * Whose records the role sees in a domain. Roles saved before the scope
 * picker stored `assigned_departments`, which meant any department the
 * person belongs to.
 */
export const domainScope = (permissions: unknown, domain: string): ScopeValue => {
  const raw = asObject(asObject(permissions).Scopes)[domain];
  if (raw === "assigned_departments") return "department_member";
  if (typeof raw === "string" && SCOPE_VALUES.has(raw as ScopeValue)) {
    return raw as ScopeValue;
  }
  // Roles saved before scopes existed saw the whole branch; they keep it.
  if (isLegacyRole(permissions)) return "branch";
  const entry = PERMISSION_CATALOG[domain];
  return (domainRank(permissions, domain) === 1 && entry?.viewScope) || "branch";
};

/** Who the caller is, for applying a scope to a query. */
export interface ScopeSubject {
  userId: number;
  /** Departments they belong to (any role). */
  departmentIds: number[];
  /** Departments they head. */
  ledDepartmentIds: number[];
  /** Life centers they are on the leadership of. */
  lifeCenterIds: number[];
}

/**
 * The department ids a scope reaches, or `null` when the scope is not
 * department-based (`branch`, `own`, …).
 */
export const scopeDepartmentIds = (
  scope: ScopeValue,
  subject: ScopeSubject,
): number[] | null => {
  if (scope === "department") return subject.ledDepartmentIds;
  if (scope === "department_member") return subject.departmentIds;
  return null;
};
