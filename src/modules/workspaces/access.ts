import { domainRank } from "../../permissions/access";

/**
 * Queue access rules shared by the builders. Each queue item may only be
 * listed when the caller can act on it with the same action key its module
 * checks. `grants` are the caller's stored role permissions in the selected
 * branch (every branch when none is selected).
 */

const parse = (value: unknown): Record<string, any> => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
};

/** The role's explicit switch for `domain.action`, if it set one. */
export const actionOverride = (permissions: unknown, domain: string, action: string): boolean | undefined => {
  const value = parse(parse(parse(permissions).Actions)[domain])[action];
  return typeof value === "boolean" ? value : undefined;
};

/**
 * True when every grant switched `domain.action` off on purpose. Used where the
 * right comes from a relationship (approval step, department head) rather than
 * the level: the role can only take it away.
 */
export const switchedOffEverywhere = (grants: unknown[], domain: string, action: string) =>
  grants.length > 0 && grants.every((g) => actionOverride(g, domain, action) === false);

/**
 * Department report sign-off (same rule as the department reports module):
 * Reports Full, or `Reports.dept_approve` switched on explicitly; switching
 * it off blocks. Needed in every grant.
 */
export const canSignOffDeptReports = (grants: unknown[]) =>
  grants.length > 0 &&
  grants.every((g) => {
    const override = actionOverride(g, "Reports", "dept_approve");
    if (override !== undefined) return override && domainRank(parse(g), "Reports") > 0;
    return domainRank(parse(g), "Reports") >= 3;
  });
