import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import type { RequestAccess } from "../../middleWare/authorization";
import {
  AppError,
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import {
  ACTION_RULES,
  APPOINTMENT_ACTIONS,
  AppointmentAction,
  DECLINE_REASONS,
  HistoryTone,
  actionStateViolation,
  actorLabel,
  appendHistory,
  formatSlotLabel,
  formatWaited,
  isAppointmentAction,
  isoDay,
  parseClock,
  parseIsoDay,
} from "./appointment-rules";
import { AppointmentSettingsService } from "./appointment-settings";
import {
  APPOINTMENT_ACTION_URLS,
  notifyAppointmentEvent,
  sendOnChannels,
} from "./appointment-notifications";
import {
  SlotUnavailableError,
  appointmentInclude,
  assertBookingRules,
  getUserName,
  lockStaffForBooking,
  mapAppointmentWithRequester,
  toNotifiableBooking,
  validateBookingWindow,
} from "./appointment-service";
import {
  BOOKING_ACTION_PERMISSION,
  canActForOthers,
} from "./appointment-access";
import { assertBranchAccessible } from "../branches/branchService";

/*
  POST /appointment/bookings/:id/actions — the redesign's booking state
  machine. The person booked may act on their own booking; remind, reassign
  and confirm_proposal, and acting on anyone else's booking, need the
  matching Appointments action (BOOKING_ACTION_PERMISSION). Each action runs
  in a transaction that locks the booking row, re-checks its state, writes
  the change plus a history line, then sends the notifications set for its
  event. Wrong-state and rule errors are 400s with toast-ready messages.
*/

type ParsedAction =
  | { action: "accept" | "reopen" | "complete" | "no_show" | "remind" | "confirm_proposal" }
  | { action: "suggest"; date: string; startTime: string; endTime: string; message: string | null }
  | { action: "decline"; reason: string; message: string | null }
  | { action: "cancel"; message: string | null }
  | { action: "reassign"; attendeeId: number };

const MAX_MESSAGE_LENGTH = 1000;

const parseMessage = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InputValidationError("The message has to be text.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new InputValidationError(
      `Keep the message to ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    );
  }
  return trimmed || null;
};

export const parseActionBody = (body: any): ParsedAction => {
  const action = body?.action;
  if (!isAppointmentAction(action)) {
    throw new InputValidationError(
      `Choose an action: ${APPOINTMENT_ACTIONS.join(", ")}.`,
    );
  }

  switch (action) {
    case "suggest": {
      const date = typeof body.date === "string" ? body.date.trim() : "";
      if (!parseIsoDay(date)) {
        throw new InputValidationError("Choose a date for the new time (YYYY-MM-DD).");
      }
      const start = parseClock(body.startTime);
      const end = parseClock(body.endTime);
      if (start === null || end === null) {
        throw new InputValidationError("Choose a start and end time for the new time.");
      }
      if (end <= start) {
        throw new InputValidationError("The end time has to be after the start time.");
      }
      return {
        action,
        date,
        startTime: String(body.startTime).trim(),
        endTime: String(body.endTime).trim(),
        message: parseMessage(body.message),
      };
    }
    case "decline": {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!(DECLINE_REASONS as readonly string[]).includes(reason)) {
        throw new InputValidationError(
          `Choose a reason: ${DECLINE_REASONS.join(", ")}.`,
        );
      }
      return { action, reason, message: parseMessage(body.message) };
    }
    case "cancel":
      return { action, message: parseMessage(body.message) };
    case "reassign": {
      const attendeeId = Number(body.attendeeId);
      if (!Number.isInteger(attendeeId) || attendeeId <= 0) {
        throw new InputValidationError("Choose who to reassign the request to.");
      }
      return { action, attendeeId };
    }
    default:
      return { action };
  }
};

/** Slot errors from validateBookingWindow as 400s the action endpoint promises. */
async function validateSlotForAction(
  tx: Prisma.TransactionClient,
  params: Parameters<typeof validateBookingWindow>[1],
  personName: string,
) {
  try {
    return await validateBookingWindow(tx, params);
  } catch (error: any) {
    if (error instanceof SlotUnavailableError) {
      throw new InputValidationError(
        `${personName || "That person"} is already booked then. Choose another time.`,
      );
    }
    if (error?.message === "Selected session is not available for this user") {
      throw new InputValidationError(
        `That time isn't in ${personName || "their"}'s schedule. Choose one of their sessions.`,
      );
    }
    throw error;
  }
}

export async function performBookingAction(
  id: number,
  callerId: number,
  body: unknown,
  access: RequestAccess | null,
) {
  const parsed = parseActionBody(body);
  const rule = ACTION_RULES[parsed.action as AppointmentAction];
  const permission = BOOKING_ACTION_PERMISSION[parsed.action];

  const initial = await prisma.appointment.findUnique({
    where: { id },
    select: { userId: true, branch_id: true },
  });
  if (!initial) {
    throw new NotFoundError("We couldn't find that appointment. It may have been deleted.");
  }

  // The person booked acts on their own booking without a role; anyone else
  // needs the action (Manage by default) on a booking in their branches.
  const canManage = canActForOthers(access, permission, initial.userId);
  if (rule.manageOnly && !canManage) {
    throw new AppError("Only appointment managers can do that.", 403);
  }
  if (!canManage && initial.userId !== callerId) {
    throw new AppError("You can only act on appointments booked with you.", 403);
  }
  if (initial.userId !== callerId) {
    assertBranchAccessible(initial.branch_id);
  }

  let newAttendee: { id: number; name: string } | null = null;
  if (parsed.action === "reassign") {
    const person = await prisma.user.findUnique({
      where: { id: parsed.attendeeId },
      select: { id: true, name: true, is_active: true },
    });
    if (!person || person.is_active === false) {
      throw new NotFoundError("We couldn't find that person.");
    }
    if (!canActForOthers(access, "reassign", person.id)) {
      throw new AppError("You can't assign appointments to that person.", 403);
    }
    newAttendee = { id: person.id, name: person.name };
  }

  const settings = await AppointmentSettingsService.get();
  const callerName = await getUserName(callerId);
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM appointment WHERE id = ${id} FOR UPDATE`;
    const booking = await tx.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });
    if (!booking) {
      throw new NotFoundError("We couldn't find that appointment. It may have been deleted.");
    }
    if (booking.userId !== initial.userId && !canManage) {
      throw new AppError("You can only act on appointments booked with you.", 403);
    }

    const violation = actionStateViolation(parsed.action, booking, now);
    if (violation) {
      throw new InputValidationError(violation);
    }

    const attendeeName = booking.user?.name || "the person booked";
    const requesterName =
      (booking.requesterId ? await getUserName(booking.requesterId) : "") ||
      booking.fullName;
    const label = actorLabel({
      actorId: callerId,
      actorName: callerName || "An admin",
      attendeeId: booking.userId,
      attendeeName,
    });
    const slotLabel = formatSlotLabel(booking.date, booking.startTime);

    let data: Prisma.appointmentUncheckedUpdateInput = {};
    let historyText = "";
    let tone: HistoryTone = "neutral";

    switch (parsed.action) {
      case "accept":
        data = {
          status: "CONFIRMED",
          acceptedAt: now,
          respondedAt: booking.respondedAt ?? now,
        };
        historyText = `Accepted by ${label}`;
        tone = "success";
        break;

      case "reopen": {
        const firstResponseWasThisAccept =
          booking.respondedAt &&
          booking.acceptedAt &&
          booking.respondedAt.getTime() === booking.acceptedAt.getTime();
        data = {
          status: "PENDING",
          acceptedAt: null,
          ...(firstResponseWasThisAccept ? { respondedAt: null } : {}),
        };
        historyText = `Acceptance undone by ${label}`;
        break;
      }

      case "suggest": {
        if (
          parsed.date === isoDay(booking.date) &&
          parsed.startTime === booking.startTime &&
          parsed.endTime === booking.endTime
        ) {
          throw new InputValidationError(
            "That's the time already booked. Choose a different time.",
          );
        }
        await lockStaffForBooking(tx, booking.userId);
        await assertBookingRules(tx, {
          staffId: booking.userId,
          date: parsed.date,
          startTime: parsed.startTime,
          settings,
          now,
        });
        const proposedDate = await validateSlotForAction(
          tx,
          {
            staffId: booking.userId,
            date: parsed.date,
            session: { start: parsed.startTime, end: parsed.endTime },
            excludeAppointmentId: id,
          },
          attendeeName,
        );
        data = {
          status: "RESCHEDULED",
          proposedDate,
          proposedStartTime: parsed.startTime,
          proposedEndTime: parsed.endTime,
          responseMessage: parsed.message,
          respondedAt: booking.respondedAt ?? now,
          acceptedAt: null,
        };
        historyText = `${label} suggested ${formatSlotLabel(parsed.date, parsed.startTime)}`;
        tone = "info";
        break;
      }

      case "decline":
        data = {
          status: "DECLINED",
          declineReason: parsed.reason,
          responseMessage: parsed.message,
          respondedAt: booking.respondedAt ?? now,
        };
        historyText = `Declined by ${label}: ${parsed.reason}`;
        tone = "danger";
        break;

      case "cancel":
        data = {
          status: "CANCELLED",
          ...(parsed.message ? { responseMessage: parsed.message } : {}),
        };
        historyText = `Cancelled by ${label}`;
        tone = "warning";
        break;

      case "complete":
        data = { status: "COMPLETED" };
        historyText = `Marked as completed by ${label}`;
        tone = "success";
        break;

      case "no_show":
        data = { status: "NO_SHOW" };
        historyText = `Marked as a no-show by ${label}`;
        tone = "warning";
        break;

      case "remind": {
        data = { remindedAt: now };
        const waited = formatWaited(now.getTime() - booking.createdAt.getTime());
        historyText = `Reminder sent to ${attendeeName} (${waited} without a reply)`;
        tone = "info";
        break;
      }

      case "reassign": {
        const target = newAttendee!;
        if (target.id === booking.userId) {
          throw new InputValidationError("This request is already with that person.");
        }
        await lockStaffForBooking(tx, target.id);
        const day = isoDay(booking.date);
        await assertBookingRules(tx, {
          staffId: target.id,
          date: day,
          startTime: booking.startTime,
          settings,
          now,
        });
        await validateSlotForAction(
          tx,
          {
            staffId: target.id,
            date: day,
            session: { start: booking.startTime, end: booking.endTime },
            excludeAppointmentId: id,
          },
          target.name,
        );
        data = {
          userId: target.id,
          status: "PENDING",
          createdAt: now,
          respondedAt: null,
          acceptedAt: null,
          remindedAt: null,
          proposedDate: null,
          proposedStartTime: null,
          proposedEndTime: null,
          declineReason: null,
          responseMessage: null,
          nudgedAt: null,
          overdueNotifiedAt: null,
          unansweredNotifiedAt: null,
          reminderSentAt: null,
          outcomePromptedAt: null,
        };
        historyText = `Reassigned from ${attendeeName} to ${target.name} by ${callerName || "an admin"}`;
        tone = "info";
        break;
      }

      case "confirm_proposal": {
        if (!booking.proposedDate || !booking.proposedStartTime) {
          throw new InputValidationError(
            "There's no suggested time to confirm on this appointment.",
          );
        }
        const proposedDay = isoDay(booking.proposedDate);
        const proposedEnd = booking.proposedEndTime ?? booking.proposedStartTime;
        await lockStaffForBooking(tx, booking.userId);
        const newDate = await validateSlotForAction(
          tx,
          {
            staffId: booking.userId,
            date: proposedDay,
            session: { start: booking.proposedStartTime, end: proposedEnd },
            excludeAppointmentId: id,
          },
          attendeeName,
        );
        data = {
          status: "CONFIRMED",
          date: newDate,
          startTime: booking.proposedStartTime,
          endTime: proposedEnd,
          proposedDate: null,
          proposedStartTime: null,
          proposedEndTime: null,
          acceptedAt: now,
          respondedAt: booking.respondedAt ?? now,
          reminderSentAt: null,
          outcomePromptedAt: null,
        };
        historyText = `${callerName || "An admin"} for ${requesterName} accepted ${formatSlotLabel(proposedDay, booking.proposedStartTime)}`;
        tone = "success";
        break;
      }
    }

    const updated = await tx.appointment.update({
      where: { id },
      data: {
        ...data,
        history: appendHistory(booking.history, historyText, tone, now) as Prisma.InputJsonValue,
      },
      include: appointmentInclude,
    });

    return { before: booking, updated, requesterName, attendeeName, slotLabel };
  });

  // Notifications, after the commit.
  const { updated, requesterName, attendeeName, slotLabel, before } = outcome;
  const notifiable = toNotifiableBooking(updated, requesterName);
  const stamp = String(now.getTime());

  switch (parsed.action) {
    case "accept":
    case "confirm_proposal":
      await notifyAppointmentEvent({
        event: "accepted",
        booking: notifiable,
        settings,
        actorId: callerId,
        dedupeSuffix: stamp,
      });
      break;
    case "suggest":
      await notifyAppointmentEvent({
        event: "suggested",
        booking: notifiable,
        settings,
        actorId: callerId,
        dedupeSuffix: stamp,
      });
      break;
    case "decline":
      await notifyAppointmentEvent({
        event: "declined",
        booking: notifiable,
        settings,
        actorId: callerId,
        dedupeSuffix: stamp,
      });
      break;
    case "cancel":
      await notifyAppointmentEvent({
        event: "cancelled",
        booking: notifiable,
        settings,
        actorId: callerId,
        dedupeSuffix: stamp,
      });
      break;
    case "remind": {
      const waited = formatWaited(now.getTime() - before.createdAt.getTime());
      // Fixed by the contract: push and SMS to the person booked.
      await sendOnChannels({
        recipientUserId: updated.userId,
        channels: ["push", "sms"],
        type: "appointment.reminder",
        message: {
          title: "Reply needed",
          body: `${requesterName || "A member"} has been waiting ${waited} for your reply about ${slotLabel}.`,
        },
        bookingId: updated.id,
        actionUrl: APPOINTMENT_ACTION_URLS.staff,
        actorUserId: callerId,
        dedupeKey: `appointment:${updated.id}:remind:${stamp}:recipient:${updated.userId}`,
        priority: "HIGH",
      });
      break;
    }
    case "reassign": {
      const newName = updated.user?.name || "someone else";
      await notifyAppointmentEvent({
        event: "new",
        booking: notifiable,
        settings,
        actorId: callerId,
        dedupeSuffix: `reassign:${stamp}`,
        messages: {
          requester: {
            title: "Request moved",
            body: `Your request for ${slotLabel} is now with ${newName} instead of ${attendeeName}.`,
          },
        },
      });
      break;
    }
    default:
      break;
  }

  return mapAppointmentWithRequester(updated);
}
