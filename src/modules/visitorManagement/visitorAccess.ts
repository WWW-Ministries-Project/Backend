import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
import { getRequestAccess } from "../../middleWare/authorization";
import { actionAllowed, domainScope } from "../../permissions/access";
import { BRANCH_FORBIDDEN_MESSAGE } from "../branches/branchScope";
import { assertBranchAccessible, BranchAccessError } from "../branches/branchService";

/**
 * Visitors actions and the "whose records" scope, applied after the visitor
 * route guards (which decide view/manage/admin and set `req.visitorScope`).
 */

export type VisitorScope = { mode: "all" | "responsible"; memberId?: number };
type VisitorResource = "visitor" | "visit" | "follow_up" | "prayer_request";

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** `responsibleMembers` is stored as a JSON string; older rows may be arrays or "1,2". */
export const parseResponsibleMemberIds = (raw: unknown): number[] => {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = raw.split(",");
    }
  } else if (typeof raw === "number") {
    values = [raw];
  }
  return Array.from(
    new Set(values.map(toPositiveInt).filter((id): id is number => Boolean(id))),
  );
};

/** Whether `scope` lets the caller see a visitor with these responsible members. */
export const visitorInScope = (scope: VisitorScope | undefined, responsibleMembers: unknown) =>
  scope?.mode !== "responsible" ||
  parseResponsibleMemberIds(responsibleMembers).includes(Number(scope.memberId));

/**
 * The guard's scope narrowed by the role: a role whose Visitors scope is
 * "assigned" (the default for View) only reaches visitors they are a
 * responsible member of, even when its level covers the whole branch.
 */
export const effectiveVisitorScope = (req: Request): VisitorScope => {
  const raw = (req as any).visitorScope as VisitorScope | undefined;
  if (raw?.mode === "responsible") return raw;
  const access = getRequestAccess(req);
  if (access && domainScope(access.permissions, "Visitors") === "assigned") {
    return { mode: "responsible", memberId: access.userId };
  }
  return { mode: "all" };
};

/** Route middleware: replaces `req.visitorScope` with the effective scope. */
export const scopeVisitors = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).visitorScope = effectiveVisitorScope(req);
  return next();
};

const forbidden = (res: Response, message: string) =>
  res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

/**
 * Whether the caller may perform `Visitors.<action>`. A responsible member
 * the guard let in for their own visitor keeps that relationship right
 * (as before roles had actions) unless their role switches the action off.
 */
const visitorActionAllowed = (req: Request, action: string) => {
  const access = getRequestAccess(req);
  if (!access) return false;
  if ((req as any).visitorScope?.mode === "responsible") {
    return access.permissions?.Actions?.Visitors?.[action] !== false;
  }
  return actionAllowed(access.permissions, "Visitors", action);
};

export const requireVisitorAction =
  (action: string, message: string) =>
  (req: Request, res: Response, next: NextFunction) =>
    visitorActionAllowed(req, action) ? next() : forbidden(res, message);

/**
 * Changing who is responsible for a visitor needs `assign_responsible`.
 * On create any responsible member counts as a change.
 */
export const requireAssignResponsibleWhenChanged = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "responsibleMembers")) {
    return next();
  }
  const next_ = parseResponsibleMemberIds(req.body.responsibleMembers).sort();
  const visitorId = toPositiveInt(req.query?.id);
  let current: number[] = [];
  if (visitorId) {
    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      select: { responsibleMembers: true },
    });
    current = parseResponsibleMemberIds(visitor?.responsibleMembers).sort();
  }
  const changed = next_.length !== current.length || next_.some((id, i) => id !== current[i]);
  if (!changed || visitorActionAllowed(req, "assign_responsible")) return next();
  return forbidden(res, "Not authorized to assign responsible members");
};

/** The member's own (non-visitor) prayer request: branch from the member. */
const prayerRequestOwnerBranch = async (prayerRequestId: number) => {
  const row = await prisma.prayer_request.findUnique({
    where: { id: prayerRequestId },
    select: { visitorId: true, user: { select: { branch_id: true } } },
  });
  return row;
};

const resourceVisitorId = async (resource: VisitorResource, id: number) => {
  if (resource === "visitor") return id;
  if (resource === "visit") {
    const row = await prisma.visit.findUnique({ where: { id }, select: { visitorId: true } });
    return toPositiveInt(row?.visitorId);
  }
  if (resource === "follow_up") {
    const row = await prisma.follow_up.findUnique({ where: { id }, select: { visitorId: true } });
    return toPositiveInt(row?.visitorId);
  }
  const row = await prisma.prayer_request.findUnique({ where: { id }, select: { visitorId: true } });
  return toPositiveInt(row?.visitorId);
};

/**
 * By-id check for a visitor record (the visitor itself, or a visit,
 * follow-up or prayer request): its visitor must be in one of the caller's
 * branches and inside their scope. Also checks a visitor named in the body
 * (creating a record, or moving one to another visitor). Unknown ids pass
 * through so the controller answers 404.
 */
export const checkVisitorRecord =
  (resource: VisitorResource) => async (req: Request, res: Response, next: NextFunction) => {
    const scope = effectiveVisitorScope(req);
    const resourceId = toPositiveInt(req.query?.id) || toPositiveInt(req.params?.id);
    const visitorIds = new Set<number>();

    if (resourceId) {
      const owner = await resourceVisitorId(resource, resourceId);
      if (owner) {
        visitorIds.add(owner);
      } else if (resource === "prayer_request") {
        // A member's own request (no visitor): branch of the member; never
        // part of a responsible member's visitors.
        const row = await prayerRequestOwnerBranch(resourceId);
        if (row) {
          if (scope.mode === "responsible") {
            return forbidden(res, "Not authorized to access this prayer request");
          }
          try {
            assertBranchAccessible(row.user?.branch_id);
          } catch (error) {
            if (error instanceof BranchAccessError) {
              return res
                .status(403)
                .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
            }
            throw error;
          }
        }
      }
    }
    const bodyVisitorId =
      toPositiveInt(req.body?.visitorId) || toPositiveInt(req.body?.source_visitor_id);
    if (bodyVisitorId) visitorIds.add(bodyVisitorId);

    if (!visitorIds.size) return next();

    const visitors = await prisma.visitor.findMany({
      where: { id: { in: Array.from(visitorIds) } },
      select: { id: true, branch_id: true, responsibleMembers: true },
    });
    for (const visitor of visitors) {
      try {
        assertBranchAccessible(visitor.branch_id);
      } catch (error) {
        if (error instanceof BranchAccessError) {
          return res
            .status(403)
            .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
        }
        throw error;
      }
      if (!visitorInScope(scope, visitor.responsibleMembers)) {
        return forbidden(res, "Not authorized to access this visitor");
      }
    }
    return next();
  };

/**
 * Converting a visitor to a member: `Members.create` (checked by the route
 * guard) plus the Visitors or Membership management conversion action.
 */
export const requireConvertVisitor = (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  const allowed =
    Boolean(access) &&
    (actionAllowed(access!.permissions, "Visitors", "convert_to_member") ||
      actionAllowed(access!.permissions, "Membership_Management", "convert_visitor"));
  return allowed ? next() : forbidden(res, "Not authorized to convert visitors to members");
};
