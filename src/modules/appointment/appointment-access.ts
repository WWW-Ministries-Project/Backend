import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
import { getRequestAccess, type RequestAccess } from "../../middleWare/authorization";
import {
  actionAllowed,
  domainRank,
  domainScope,
  isLegacyRole,
} from "../../permissions/access";
import { assertBranchAccessible } from "../branches/branchService";

/*
  Appointments actions and scopes (permissions redesign §7.12). These run
  after a permission guard (or `withAccess`) has set `req.access` with the
  caller's live, active-branch permissions.

  - Scope: `own` (bookings they requested or are booked on) or `branch`.
    The catalogue starts View-only roles at `own`; a role saved before the
    role editor had actions (no `Actions` key) and no stored scope keeps
    today's whole-branch view, so nobody loses what they see.
  - The person booked (attendee) always acts on their own booking; acting on
    someone else's needs the action plus Manage (or the action switched on
    explicitly), and a whole-branch scope.
*/

const DOMAIN = "Appointments";

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const forbidden = (res: Response, message: string) =>
  res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

/** Whose bookings the role sees: "own" or "branch". */
export const appointmentScopeOf = (permissions: unknown): "own" | "branch" => {
  const stored = asObject(asObject(permissions).Scopes)[DOMAIN];
  if (typeof stored !== "string" && isLegacyRole(permissions)) return "branch";
  return domainScope(permissions, DOMAIN) === "own" ? "own" : "branch";
};

/**
 * People hidden from this role (Settings › Access rights › hidden people).
 * Same keys the route guards read: `Exclusions.Appointments`, falling back
 * to Members like the domain level does.
 */
export const appointmentExclusions = (permissions: unknown): number[] => {
  const blob = asObject(permissions);
  const nested = asObject(blob.Exclusions ?? blob.exclusions);
  for (const key of [DOMAIN, "Members"]) {
    for (const source of [blob[`${key}_exclusions`], blob[key], nested[key], nested[`${key}_exclusions`]]) {
      if (Array.isArray(source)) {
        const ids = source.map(toPositiveInt).filter((id): id is number => Boolean(id));
        if (ids.length) return ids;
      }
    }
  }
  return [];
};

/**
 * Whether the role may perform `action` on someone else's booking or
 * schedule: the action, at Manage (or switched on explicitly), whole branch.
 */
export const canActForOthers = (
  access: RequestAccess | null,
  action: string,
  targetUserId?: number | null,
): boolean => {
  if (!access?.isPrivilegedUser) return false;
  const { permissions } = access;
  if (!actionAllowed(permissions, DOMAIN, action)) return false;
  const explicit = asObject(asObject(asObject(permissions).Actions)[DOMAIN])[action] === true;
  if (domainRank(permissions, DOMAIN) < 2 && !explicit) return false;
  if (appointmentScopeOf(permissions) === "own") return false;
  if (targetUserId && appointmentExclusions(permissions).includes(targetUserId)) return false;
  return true;
};

/** Whether the role may perform `action` at all (own records included). */
export const hasAppointmentAction = (access: RequestAccess | null, action: string) =>
  Boolean(access?.isPrivilegedUser && actionAllowed(access.permissions, DOMAIN, action));

/**
 * After `can_view_appointments_scoped`: narrows a whole-branch read to the
 * caller's own bookings when the role's scope is `own`, and for a single
 * booking keeps it inside the caller's scope and branches.
 */
export const applyAppointmentViewScope = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const access = getRequestAccess(req);
  const scope = (req as any).appointmentScope;
  if (access && scope?.mode === "all" && appointmentScopeOf(access.permissions) === "own") {
    (req as any).appointmentScope = { mode: "own", userId: access.userId };
  }

  const bookingId = toPositiveInt(req.params?.id);
  if (bookingId && access && req.path.startsWith("/bookings/")) {
    const booking = await prisma.appointment.findUnique({
      where: { id: bookingId },
      select: { requesterId: true, userId: true, branch_id: true },
    });
    if (booking) {
      const isParty =
        booking.requesterId === access.userId || booking.userId === access.userId;
      if (!isParty) {
        if ((req as any).appointmentScope?.mode !== "all") {
          return forbidden(res, "You can only open appointments you booked or are booked on.");
        }
        assertBranchAccessible(booking.branch_id);
      }
    }
  }
  return next();
};

/**
 * Edits, status toggles and deletes of one booking (after a manage or
 * delete guard): the booking must be in the caller's scope and branches,
 * its attendee not hidden from them, and moving it to someone else needs
 * `reassign`. `action`, when given, is also needed on bookings the caller
 * isn't part of. Reads the booking id from `:id` or `?id=`.
 */
export const guardBookingChange = (action?: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    const bookingId = toPositiveInt(req.params?.id) ?? toPositiveInt(req.query?.id);
    if (!access || !bookingId) return next();

    const booking = await prisma.appointment.findUnique({
      where: { id: bookingId },
      select: { requesterId: true, userId: true, branch_id: true },
    });
    if (!booking) return next();

    const isParty =
      booking.requesterId === access.userId || booking.userId === access.userId;
    if (!isParty) {
      if (appointmentScopeOf(access.permissions) === "own") {
        return forbidden(res, "You can only change appointments you booked or are booked on.");
      }
      assertBranchAccessible(booking.branch_id);
      if (action && !canActForOthers(access, action)) {
        return forbidden(res, "Your role doesn't allow that on other people's appointments.");
      }
    }
    if (appointmentExclusions(access.permissions).includes(booking.userId)) {
      return forbidden(res, "You can't change appointments booked with that person.");
    }

    const newAttendee =
      toPositiveInt(req.body?.userId) ??
      toPositiveInt(req.body?.staffId) ??
      toPositiveInt(req.body?.attendeeId) ??
      toPositiveInt(req.body?.attendee_id);
    if (newAttendee && newAttendee !== booking.userId && !canActForOthers(access, "reassign", newAttendee)) {
      return forbidden(res, "Your role doesn't allow reassigning appointments.");
    }
    return next();
  };

/**
 * Availability, pause and time off. A person's own schedule needs
 * `manage_own_availability` (View); anyone else's needs
 * `manage_others_availability` (Manage). Run after `withAccess`.
 * `others` overrides the action for someone else's schedule (deleting a
 * slot stays a Full `delete`, as before).
 */
export const guardAvailabilityChange = (others = "manage_others_availability") =>
  async (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    if (!access?.isPrivilegedUser) {
      return forbidden(res, "Not authorized to manage appointment availability");
    }

    const path = String(req.path || "");
    const recordId = toPositiveInt(req.params?.id);
    let targetUserId: number | null =
      toPositiveInt(req.params?.userId) ?? toPositiveInt(req.body?.userId);
    let branchId: number | null = null;

    if (recordId && path.includes("time-off")) {
      const entry = await prisma.appointment_time_off.findUnique({
        where: { id: recordId },
        select: { user_id: true },
      });
      targetUserId = entry?.user_id ?? targetUserId;
    } else if (recordId) {
      const slot = await prisma.availability.findUnique({
        where: { id: recordId },
        select: { userId: true, branch_id: true },
      });
      if (slot) {
        // Moving a slot to someone else counts as changing theirs too.
        const movedTo = toPositiveInt(req.body?.userId);
        if (movedTo && movedTo !== slot.userId && !canActForOthers(access, others, movedTo)) {
          return forbidden(res, "Your role doesn't allow changing other people's availability.");
        }
        targetUserId = slot.userId;
        branchId = slot.branch_id;
      }
    }

    if (targetUserId && targetUserId === access.userId) {
      return hasAppointmentAction(access, "manage_own_availability")
        ? next()
        : forbidden(res, "Your role doesn't allow managing your own availability.");
    }
    if (!canActForOthers(access, others, targetUserId)) {
      return forbidden(res, "Your role doesn't allow changing other people's availability.");
    }
    assertBranchAccessible(branchId);
    return next();
  };

/**
 * Booking rules, notification settings and booking reasons: `configure`
 * (Full). Roles saved before actions existed keep the old Manage rule.
 */
export const requireAppointmentConfigure = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const access = getRequestAccess(req);
  if (!access?.isPrivilegedUser) {
    return forbidden(res, "Not authorized to manage appointment settings");
  }
  const { permissions } = access;
  if (
    actionAllowed(permissions, DOMAIN, "configure") ||
    (isLegacyRole(permissions) && domainRank(permissions, DOMAIN) >= 2)
  ) {
    return next();
  }
  return forbidden(res, "Not authorized to manage appointment settings");
};

/** The booking-action key (state machine) → catalogue action. */
export const BOOKING_ACTION_PERMISSION: Record<string, string> = {
  accept: "respond",
  reopen: "respond",
  suggest: "respond",
  decline: "respond",
  confirm_proposal: "respond",
  complete: "complete",
  no_show: "complete",
  cancel: "cancel_any",
  remind: "send_reminders",
  reassign: "reassign",
};
