import { listUserIdsWithDomainPermission } from "../../middleWare/authorization";
import {
  NotificationPriority,
  notificationService,
} from "../notifications/notificationService";
import {
  AppointmentAudience,
  AppointmentChannel,
  AppointmentEvent,
  AppointmentSettings,
} from "./appointment-settings";
import { formatSlotLabel } from "./appointment-rules";

/*
  Sends appointment notifications by the settings matrix
  (event × attendee/requester/admins × push/sms/email).

  Channels map onto the shared notification service: "push" is the in-app row
  plus web/Expo push, "email" and "sms" are its email and SMS deliveries. The
  matrix is the policy (channelsFromPolicy), so SMS goes out without a member
  opt-in, but an explicit opt-out in a member's notification preferences
  still wins. A recipient gets one message per event even when they fill two
  roles (attendee > requester > admins), and the person who acted gets none.
  Failures are logged, never thrown: a booking action must not fail because
  a notification did.
*/

export type NotifiableBooking = {
  id: number;
  userId: number;
  requesterId: number | null;
  date: Date;
  startTime: string;
  endTime: string;
  fullName: string;
  attendeeName: string;
  requesterName: string;
  proposedDate?: Date | null;
  proposedStartTime?: string | null;
  declineReason?: string | null;
  responseMessage?: string | null;
};

type Message = { title: string; body: string };

const NOTIFICATION_TYPES: Record<AppointmentEvent, string> = {
  new: "appointment.booked",
  nudge: "appointment.reminder",
  overdue: "appointment.overdue",
  accepted: "appointment.status_changed",
  suggested: "appointment.status_changed",
  declined: "appointment.status_changed",
  cancelled: "appointment.status_changed",
  reminder: "appointment.reminder",
  outcome: "appointment.reminder",
};

const STAFF_ACTION_URL = "/home/appointments";
const MEMBER_ACTION_URL = "/member/appointments";

const withNote = (body: string, note?: string | null) =>
  note && note.trim() ? `${body} Note: "${note.trim()}"` : body;

export const buildEventMessages = (
  event: AppointmentEvent,
  booking: NotifiableBooking,
  settings: Pick<AppointmentSettings, "replyDeadlineHours">,
): Record<AppointmentAudience, Message> => {
  const member = booking.requesterName || booking.fullName || "A member";
  const attendee = booking.attendeeName || "The person booked";
  const slot = formatSlotLabel(booking.date, booking.startTime);
  const proposed =
    booking.proposedDate && booking.proposedStartTime
      ? formatSlotLabel(booking.proposedDate, booking.proposedStartTime)
      : slot;

  switch (event) {
    case "new":
      return {
        attendee: {
          title: "New appointment request",
          body: `${member} asked to meet you on ${slot}. Reply within ${settings.replyDeadlineHours} hours.`,
        },
        requester: {
          title: "Request sent",
          body: `Your request to meet ${attendee} on ${slot} has been sent. You'll hear back soon.`,
        },
        admins: {
          title: "New appointment request",
          body: `${member} asked to meet ${attendee} on ${slot}.`,
        },
      };
    case "nudge":
      return {
        attendee: {
          title: "Reply needed",
          body: `${member} is waiting for your reply about ${slot}.`,
        },
        requester: {
          title: "Still waiting for a reply",
          body: `${attendee} hasn't replied yet about ${slot}.`,
        },
        admins: {
          title: "Reply needed",
          body: `${attendee} hasn't replied to ${member} about ${slot} yet.`,
        },
      };
    case "overdue":
      return {
        attendee: {
          title: "Request overdue",
          body: `${member}'s request for ${slot} is past its reply deadline. Accept, suggest another time or decline.`,
        },
        requester: {
          title: "Still waiting for a reply",
          body: `${attendee} hasn't replied yet. The church office has been told.`,
        },
        admins: {
          title: "Appointment request overdue",
          body: `${attendee} hasn't replied to ${member}'s request for ${slot}. Remind them or reassign it.`,
        },
      };
    case "accepted":
      return {
        attendee: {
          title: "Appointment confirmed",
          body: `Your appointment with ${member} on ${slot} is confirmed.`,
        },
        requester: {
          title: "Appointment confirmed",
          body: `${attendee} will see you on ${slot}.`,
        },
        admins: {
          title: "Appointment confirmed",
          body: `${attendee} will see ${member} on ${slot}.`,
        },
      };
    case "suggested":
      return {
        attendee: {
          title: "New time suggested",
          body: `${proposed} was suggested to ${member} instead of ${slot}.`,
        },
        requester: {
          title: "New time suggested",
          body: withNote(`${attendee} suggested ${proposed} instead. Open the app to accept or pick another time.`, booking.responseMessage),
        },
        admins: {
          title: "New time suggested",
          body: `${attendee} suggested ${proposed} to ${member} instead of ${slot}.`,
        },
      };
    case "declined": {
      const reason = booking.declineReason ? ` (${booking.declineReason})` : "";
      return {
        attendee: {
          title: "Request declined",
          body: `${member}'s request for ${slot} was declined${reason}.`,
        },
        requester: {
          title: "Request declined",
          body: withNote(`${attendee} can't meet on ${slot}${reason}. You can book someone else.`, booking.responseMessage),
        },
        admins: {
          title: "Appointment request declined",
          body: `${attendee} declined ${member}'s request for ${slot}${reason}.`,
        },
      };
    }
    case "cancelled":
      return {
        attendee: {
          title: "Appointment cancelled",
          body: `The appointment with ${member} on ${slot} was cancelled.`,
        },
        requester: {
          title: "Appointment cancelled",
          body: withNote(`Your appointment with ${attendee} on ${slot} was cancelled.`, booking.responseMessage),
        },
        admins: {
          title: "Appointment cancelled",
          body: `${member}'s appointment with ${attendee} on ${slot} was cancelled.`,
        },
      };
    case "reminder":
      return {
        attendee: {
          title: "Upcoming appointment",
          body: `You're meeting ${member} on ${slot}.`,
        },
        requester: {
          title: "Upcoming appointment",
          body: `You're meeting ${attendee} on ${slot}.`,
        },
        admins: {
          title: "Upcoming appointment",
          body: `${member} is meeting ${attendee} on ${slot}.`,
        },
      };
    case "outcome":
      return {
        attendee: {
          title: "How did it go?",
          body: `Record whether your appointment with ${member} on ${slot} took place.`,
        },
        requester: {
          title: "Thanks for coming",
          body: `We hope your appointment with ${attendee} went well.`,
        },
        admins: {
          title: "Outcome not recorded",
          body: `Record how ${member}'s appointment with ${attendee} on ${slot} went.`,
        },
      };
  }
};

/** One message on the given channels; nothing when the list is empty. */
export const sendOnChannels = async (args: {
  recipientUserId: number;
  channels: AppointmentChannel[];
  type: string;
  message: Message;
  bookingId: number;
  actionUrl: string;
  actorUserId?: number | null;
  dedupeKey: string;
  priority?: NotificationPriority;
}) => {
  if (!args.channels.length) return;
  try {
    await notificationService.createInAppNotification({
      type: args.type,
      title: args.message.title,
      body: args.message.body,
      recipientUserId: args.recipientUserId,
      actorUserId: args.actorUserId ?? null,
      entityType: "APPOINTMENT",
      entityId: String(args.bookingId),
      actionUrl: args.actionUrl,
      priority: args.priority ?? "MEDIUM",
      dedupeKey: args.dedupeKey,
      emailSubject: args.message.title,
      sendPush: args.channels.includes("push"),
      sendEmail: args.channels.includes("email"),
      sendSms: args.channels.includes("sms"),
      smsBody: args.message.body,
      channelsFromPolicy: true,
    });
  } catch (error: any) {
    console.error(
      `[ERROR] Appointment notification failed (booking ${args.bookingId}, user ${args.recipientUserId}):`,
      error?.message || error,
    );
  }
};

export const listAppointmentAdminIds = () =>
  listUserIdsWithDomainPermission("Appointments", "manage");

/**
 * Sends `event` for a booking to everyone the matrix names.
 * `dedupeSuffix` makes repeatable events (a second suggest) distinct;
 * once-only scheduled events leave it out. `adminIds` lets the scheduled job
 * resolve admins once per run. `messages` overrides the default wording for
 * some audiences; `audiences` limits who is considered.
 */
export const notifyAppointmentEvent = async (args: {
  event: AppointmentEvent;
  booking: NotifiableBooking;
  settings: AppointmentSettings;
  actorId?: number | null;
  dedupeSuffix?: string;
  adminIds?: number[];
  audiences?: AppointmentAudience[];
  messages?: Partial<Record<AppointmentAudience, Message>>;
  matrixEvent?: AppointmentEvent;
  /** Also notify the actor (a member's own "request sent" receipt). */
  notifyActor?: boolean;
}) => {
  const { event, booking, settings } = args;
  const matrix = settings.notifications[args.matrixEvent ?? event];
  const audiences = args.audiences ?? ["attendee", "requester", "admins"];
  const messages = { ...buildEventMessages(event, booking, settings), ...(args.messages || {}) };
  const actorId = args.actorId ?? null;
  const excludedId = args.notifyActor ? null : actorId;

  const plan = new Map<number, AppointmentAudience>();
  const claim = (userId: number | null | undefined, audience: AppointmentAudience) => {
    if (!userId || userId === excludedId || plan.has(userId)) return;
    if (!audiences.includes(audience) || !matrix[audience].length) return;
    plan.set(userId, audience);
  };

  claim(booking.userId, "attendee");
  claim(booking.requesterId, "requester");
  if (audiences.includes("admins") && matrix.admins.length) {
    let adminIds = args.adminIds;
    if (!adminIds) {
      try {
        adminIds = await listAppointmentAdminIds();
      } catch (error: any) {
        console.error("[ERROR] Could not resolve appointment admins:", error?.message || error);
        adminIds = [];
      }
    }
    adminIds.forEach((id) => claim(id, "admins"));
  }

  const suffix = args.dedupeSuffix ? `:${args.dedupeSuffix}` : "";
  for (const [recipientUserId, audience] of plan) {
    await sendOnChannels({
      recipientUserId,
      channels: matrix[audience],
      type: NOTIFICATION_TYPES[event],
      message: messages[audience],
      bookingId: booking.id,
      actionUrl: audience === "requester" ? MEMBER_ACTION_URL : STAFF_ACTION_URL,
      actorUserId: actorId,
      dedupeKey: `appointment:${booking.id}:${event}${suffix}:recipient:${recipientUserId}`,
      priority: event === "overdue" ? "HIGH" : "MEDIUM",
    });
  }
};

export const APPOINTMENT_ACTION_URLS = {
  staff: STAFF_ACTION_URL,
  member: MEMBER_ACTION_URL,
};
