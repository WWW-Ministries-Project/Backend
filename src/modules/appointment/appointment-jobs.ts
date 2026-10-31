import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  OUTCOME_PROMPT_DELAY_MS,
  addDaysIso,
  appendHistory,
  churchTodayIso,
  formatSlotLabel,
  formatWaited,
  isoDay,
  parseIsoDay,
  slotInstant,
} from "./appointment-rules";
import { AppointmentSettings, AppointmentSettingsService } from "./appointment-settings";
import {
  APPOINTMENT_ACTION_URLS,
  listAppointmentAdminIds,
  notifyAppointmentEvent,
  sendOnChannels,
} from "./appointment-notifications";
import { appointmentInclude, getUserName, toNotifiableBooking } from "./appointment-service";

/*
  Scheduled appointment notifications (run every 15 minutes by
  src/cron-jobs/appointmentNotificationCron.ts):

  - nudge:      PENDING past half the reply deadline (not yet overdue)
  - overdue:    PENDING past the reply deadline; history "Overdue: admins alerted"
  - unanswered: PENDING older than unansweredAfterHours (when not 0); the
                member is told and offered other people; stays PENDING
  - reminder:   CONFIRMED, reminderHours before the start
  - outcome:    CONFIRMED, 2 hours after the end

  Each booking is claimed under a row lock by setting its marker column
  (nudgedAt, overdueNotifiedAt, unansweredNotifiedAt, reminderSentAt,
  outcomePromptedAt) before anything is sent, so overlapping runs or a second
  worker never double-send. Actions that restart a clock (reassign, a new
  confirmed time) clear the markers.
*/

type Marker =
  | "nudgedAt"
  | "overdueNotifiedAt"
  | "unansweredNotifiedAt"
  | "reminderSentAt"
  | "outcomePromptedAt";

const BATCH_SIZE = 200;
const HOUR_MS = 3_600_000;

type BookingRow = Prisma.appointmentGetPayload<{ include: typeof appointmentInclude }>;

/**
 * Locks the booking, re-checks it still qualifies, sets the marker and
 * (optionally) appends a history line. Returns the fresh row, or null when
 * another run got there first or the booking moved on.
 */
async function claim(
  id: number,
  marker: Marker,
  stillDue: (row: BookingRow) => boolean,
  history: ((row: BookingRow) => { text: string; tone: "neutral" | "info" | "warning" | "danger" }) | null,
  now: Date,
): Promise<BookingRow | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM appointment WHERE id = ${id} FOR UPDATE`;
    const row = await tx.appointment.findUnique({ where: { id }, include: appointmentInclude });
    if (!row || row[marker] !== null || !stillDue(row)) return null;
    const line = history ? history(row) : null;
    return tx.appointment.update({
      where: { id },
      data: {
        [marker]: now,
        ...(line
          ? { history: appendHistory(row.history, line.text, line.tone, now) as Prisma.InputJsonValue }
          : {}),
      },
      include: appointmentInclude,
    });
  });
}

async function requesterNameOf(row: BookingRow) {
  return (row.requesterId ? await getUserName(row.requesterId) : "") || row.fullName;
}

export async function runAppointmentJobs(now: Date = new Date()) {
  const settings: AppointmentSettings = await AppointmentSettingsService.get();
  const counts = { nudge: 0, overdue: 0, unanswered: 0, reminder: 0, outcome: 0 };

  let adminIdsCache: number[] | null = null;
  const adminIds = async () => {
    if (!adminIdsCache) adminIdsCache = await listAppointmentAdminIds();
    return adminIdsCache;
  };

  const deadlineMs = settings.replyDeadlineHours * HOUR_MS;
  const overdueCutoff = new Date(now.getTime() - deadlineMs);
  const nudgeCutoff = new Date(now.getTime() - deadlineMs / 2);

  // Overdue
  const overdue = await prisma.appointment.findMany({
    where: { status: "PENDING", overdueNotifiedAt: null, createdAt: { lte: overdueCutoff } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  for (const { id } of overdue) {
    const row = await claim(
      id,
      "overdueNotifiedAt",
      (r) => r.status === "PENDING" && r.createdAt <= overdueCutoff,
      () => ({ text: "Overdue: admins alerted", tone: "danger" }),
      now,
    );
    if (!row) continue;
    counts.overdue += 1;
    await notifyAppointmentEvent({
      event: "overdue",
      booking: toNotifiableBooking(row, await requesterNameOf(row)),
      settings,
      adminIds: await adminIds(),
      dedupeSuffix: String(row.createdAt.getTime()),
    });
  }

  // Nudge (half the reply deadline, not yet overdue)
  const nudges = await prisma.appointment.findMany({
    where: {
      status: "PENDING",
      nudgedAt: null,
      createdAt: { lte: nudgeCutoff, gt: overdueCutoff },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  for (const { id } of nudges) {
    const row = await claim(
      id,
      "nudgedAt",
      (r) => r.status === "PENDING" && r.createdAt <= nudgeCutoff,
      (r) => ({
        text: `Reminder sent to ${r.user?.name || "the person booked"} (${formatWaited(now.getTime() - r.createdAt.getTime())} without a reply)`,
        tone: "info",
      }),
      now,
    );
    if (!row) continue;
    counts.nudge += 1;
    await notifyAppointmentEvent({
      event: "nudge",
      booking: toNotifiableBooking(row, await requesterNameOf(row)),
      settings,
      adminIds: await adminIds(),
      dedupeSuffix: String(row.createdAt.getTime()),
    });
  }

  // Unanswered: tell the member, offer other people. Stays PENDING.
  if (settings.unansweredAfterHours > 0) {
    const unansweredCutoff = new Date(now.getTime() - settings.unansweredAfterHours * HOUR_MS);
    const unanswered = await prisma.appointment.findMany({
      where: {
        status: "PENDING",
        unansweredNotifiedAt: null,
        createdAt: { lte: unansweredCutoff },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });
    for (const { id } of unanswered) {
      const row = await claim(
        id,
        "unansweredNotifiedAt",
        (r) => r.status === "PENDING" && r.createdAt <= unansweredCutoff,
        (r) => ({
          text: `No reply after ${settings.unansweredAfterHours} h: ${r.fullName} offered other people`,
          tone: "warning",
        }),
        now,
      );
      if (!row) continue;
      counts.unanswered += 1;
      if (row.requesterId) {
        await sendOnChannels({
          recipientUserId: row.requesterId,
          channels: ["push"],
          type: "appointment.overdue",
          message: {
            title: "Still no reply",
            body: `${row.user?.name || "The person you booked"} hasn't replied to your request for ${formatSlotLabel(row.date, row.startTime)}. It stays open, or you can book someone else.`,
          },
          bookingId: row.id,
          actionUrl: APPOINTMENT_ACTION_URLS.member,
          dedupeKey: `appointment:${row.id}:unanswered:${row.createdAt.getTime()}:recipient:${row.requesterId}`,
        });
      }
    }
  }

  const today = churchTodayIso(now);

  // Reminder: reminderHours before the start
  const reminderLeadMs = settings.reminderHours * HOUR_MS;
  const reminders = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      date: {
        gte: parseIsoDay(addDaysIso(today, -1))!,
        lte: parseIsoDay(addDaysIso(today, Math.ceil(settings.reminderHours / 24) + 1))!,
      },
    },
    select: { id: true, date: true, startTime: true },
    take: BATCH_SIZE * 5,
  });
  const reminderDue = (r: { date: Date; startTime: string }) => {
    const start = slotInstant(r.date, r.startTime);
    return (
      !!start &&
      start.getTime() > now.getTime() &&
      start.getTime() - reminderLeadMs <= now.getTime()
    );
  };
  for (const candidate of reminders.filter(reminderDue).slice(0, BATCH_SIZE)) {
    const row = await claim(
      candidate.id,
      "reminderSentAt",
      (r) => r.status === "CONFIRMED" && reminderDue(r),
      null,
      now,
    );
    if (!row) continue;
    counts.reminder += 1;
    await notifyAppointmentEvent({
      event: "reminder",
      booking: toNotifiableBooking(row, await requesterNameOf(row)),
      settings,
      adminIds: await adminIds(),
      dedupeSuffix: `${isoDay(row.date)}T${row.startTime}`,
    });
  }

  // Outcome: 2 hours after the end
  const outcomes = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMED",
      outcomePromptedAt: null,
      date: {
        gte: parseIsoDay(addDaysIso(today, -7))!,
        lte: parseIsoDay(today)!,
      },
    },
    select: { id: true, date: true, startTime: true, endTime: true },
    take: BATCH_SIZE * 5,
  });
  const outcomeDue = (r: { date: Date; startTime: string; endTime: string }) => {
    const end = slotInstant(r.date, r.endTime) ?? slotInstant(r.date, r.startTime);
    return !!end && end.getTime() + OUTCOME_PROMPT_DELAY_MS <= now.getTime();
  };
  for (const candidate of outcomes.filter(outcomeDue).slice(0, BATCH_SIZE)) {
    const row = await claim(
      candidate.id,
      "outcomePromptedAt",
      (r) => r.status === "CONFIRMED" && outcomeDue(r),
      null,
      now,
    );
    if (!row) continue;
    counts.outcome += 1;
    await notifyAppointmentEvent({
      event: "outcome",
      booking: toNotifiableBooking(row, await requesterNameOf(row)),
      settings,
      adminIds: await adminIds(),
      dedupeSuffix: `${isoDay(row.date)}T${row.endTime}`,
    });
  }

  return counts;
}
