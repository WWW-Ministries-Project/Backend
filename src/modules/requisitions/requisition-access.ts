import { Prisma } from "@prisma/client";
import { getRequestAccess } from "../../middleWare/authorization";
import { actionAllowed, domainRank, domainScope } from "../../permissions/access";
import type { ScopeValue } from "../../permissions/catalog";
import { UnauthorizedError } from "../../utils/custom-error-handlers";

/**
 * Who is acting on requisitions and what their role lets them do, read from
 * the live, active-branch permissions a guard (`withAccess`, `requireAction`)
 * put on the request — never the login token's.
 *
 * Relationship rules stay outside the role: the requester always sees and
 * edits their own drafts, and whoever holds the current approval step may
 * act on it. A role's action switches can only take those away (e.g. a View
 * role with `approve` switched off), so members with no Requisition role keep
 * raising and approving as the chain allows.
 */

const DOMAIN = "Requisition";

export type RequisitionViewer = {
  userId: number;
  permissions: Record<string, any>;
  /** Departments the viewer belongs to (any role). */
  departmentIds: number[];
  /** Departments the viewer heads. */
  ledDepartmentIds: number[];
};

const toUserId = (value: unknown): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UnauthorizedError("Authenticated user not found");
  }
  return id;
};

/**
 * `req.user` plus the caller's department lists from `req.access` (set by
 * every permission guard), for services that take a user object.
 * `req.user.permissions` is already the live, active-branch set there.
 */
export const requisitionUserFrom = (req: any) => {
  const access = getRequestAccess(req);
  return {
    ...(req?.user ?? {}),
    ...(access ? { permissions: access.permissions } : {}),
    departmentIds: access?.departmentIds ?? [],
    ledDepartmentIds: access?.ledDepartmentIds ?? [],
  };
};

/** The viewer behind a user object (see `requisitionUserFrom`). */
export const toRequisitionViewer = (user: any): RequisitionViewer => ({
  userId: toUserId(user?.id),
  permissions: (user?.permissions ?? {}) as Record<string, any>,
  departmentIds: Array.isArray(user?.departmentIds) ? user.departmentIds : [],
  ledDepartmentIds: Array.isArray(user?.ledDepartmentIds) ? user.ledDepartmentIds : [],
});

export const requisitionRank = (viewer: RequisitionViewer) =>
  domainRank(viewer.permissions, DOMAIN);

/** The role grants `Requisition.<action>` (level default or explicit switch). */
export const canRequisition = (viewer: RequisitionViewer, action: string) =>
  actionAllowed(viewer.permissions, DOMAIN, action);

/**
 * For actions a relationship already grants (requester, current approver):
 * allowed unless the viewer's role has a Requisition level and switches the
 * action off.
 */
export const requisitionActionNotRevoked = (viewer: RequisitionViewer, action: string) =>
  requisitionRank(viewer) === 0 || canRequisition(viewer, action);

/** Whose requisitions the role sees. No Requisition role: only their own. */
export const requisitionScope = (viewer: RequisitionViewer): ScopeValue => {
  if (requisitionRank(viewer) === 0) return "own";
  const scope = domainScope(viewer.permissions, DOMAIN);
  return scope === "department" || scope === "branch" ? scope : "own";
};

/** Sees every requisition in the branch (what "manager" meant before scopes). */
export const seesWholeBranch = (viewer: RequisitionViewer) =>
  requisitionScope(viewer) === "branch";

/**
 * The requisitions the viewer's scope reaches (excluding approval
 * participation, which callers add when they want it). `{}` = whole branch.
 */
export const requisitionScopeWhere = (viewer: RequisitionViewer): Prisma.requestWhereInput => {
  const scope = requisitionScope(viewer);
  if (scope === "branch") return {};
  if (scope === "department") {
    return {
      OR: [
        { user_id: viewer.userId },
        ...(viewer.ledDepartmentIds.length
          ? [{ department_id: { in: viewer.ledDepartmentIds } }]
          : []),
      ],
    };
  }
  return { user_id: viewer.userId };
};

/** Scope plus the requisitions that have a step assigned to (or acted on by) the viewer. */
export const requisitionVisibleWhere = (viewer: RequisitionViewer): Prisma.requestWhereInput => {
  const scoped = requisitionScopeWhere(viewer);
  if (!Object.keys(scoped).length) return {};
  return {
    OR: [
      scoped,
      { approval_instances: { some: { approver_user_id: viewer.userId } } },
      { approval_instances: { some: { acted_by_user_id: viewer.userId } } },
    ],
  };
};

/** Whether the viewer's scope reaches one requisition (requester / department). */
export const scopeCoversRequisition = (
  viewer: RequisitionViewer,
  requisition: { user_id: number; department_id: number },
) => {
  const scope = requisitionScope(viewer);
  if (scope === "branch") return true;
  if (requisition.user_id === viewer.userId) return true;
  return scope === "department" && viewer.ledDepartmentIds.includes(requisition.department_id);
};

/** What the viewer's role allows, for clients to show the right controls. */
export const requisitionCapabilities = (viewer: RequisitionViewer) => ({
  scope: requisitionScope(viewer),
  raise_for_any_department: canRequisition(viewer, "raise_for_any_department"),
  send_reminders: canRequisition(viewer, "send_reminders"),
  export: canRequisition(viewer, "export"),
  mark_disbursed: canRequisition(viewer, "mark_disbursed"),
  delete: canRequisition(viewer, "delete"),
  override_step: canRequisition(viewer, "override_step"),
  configure_approvals: canRequisition(viewer, "configure_approvals"),
});
