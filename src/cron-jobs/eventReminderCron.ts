/**
 * eventReminderCron.ts
 *
 * Runs every minute.  Finds event_reminder rows whose `remind_at` timestamp
 * has passed and whose `status` is still PENDING, fires an in-app (and
 * optionally SMS) notification to every registered attendee, then marks the
 * reminder as SENT.  Failed rows are marked FAILED so the admin cron can
 * surface them.
 */

import cron from "node-cron";
import { prisma } from "../Models/context";
import { notificationService } from "../modules/notifications/notificationService";

let isReminderJobRunning = false;

const REMINDER_LABEL_MAP: Record<number, string> = {
  0:     "is starting now",
  5:     "starts in 5 minutes",
  10:    "starts in 10 minutes",
  15:    "starts in 15 minutes",
  30:    "starts in 30 minutes",
  60:    "starts in 1 hour",
  120:   "starts in 2 hours",
  1440:  "starts tomorrow",
  2880:  "starts in 2 days",
  10080: "starts in 1 week",
};

function buildReminderLabel(offsetMinutes: number): string {
  return REMINDER_LABEL_MAP[offsetMinutes] ?? `starts in ${offsetMinutes} minutes`;
}

export async function processEventRemindersJob() {
  if (isReminderJobRunning) {
    return;
  }

  isReminderJobRunning = true;
  const startedAt = Date.now();

  try {
    console.info("[INFO] Starting event reminder processing job");

    // Fetch all PENDING reminders whose fire time has passed, including event
    // details needed for the notification body.
    const dueReminders = await prisma.event_reminder.findMany({
      where: {
        status: "PENDING",
        remind_at: { lte: new Date() },
      },
      select: {
        id: true,
        offset_minutes: true,
        method: true,
        event: {
          select: {
            id: true,
            start_time: true,
            location: true,
            event: { select: { event_name: true } },
            event_registers: {
              where: { user_id: { not: null } },
              select: { user_id: true },
            },
          },
        },
      },
      // Cap at 200 per tick to avoid overwhelming the notification service.
      take: 200,
    });

    if (!dueReminders.length) {
      return;
    }

    console.info(`[INFO] Processing ${dueReminders.length} due reminder(s)`);

    for (const reminder of dueReminders) {
      try {
        const event = reminder.event;
        const eventName = event?.event?.event_name ?? "An event";
        const label = buildReminderLabel(reminder.offset_minutes);

        const recipientUserIds = Array.from(
          new Set(
            (event?.event_registers ?? [])
              .map((r) => Number(r.user_id))
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
        );

        if (recipientUserIds.length) {
          const sendSms =
            reminder.method === "sms" || reminder.method === "both";

          await notificationService.createManyInAppNotifications(
            recipientUserIds.map((recipientUserId) => ({
              type: "event.reminder",
              title: `Reminder: ${eventName}`,
              body: `"${eventName}" ${label}.${event?.location ? ` Location: ${event.location}` : ""}`,
              recipientUserId,
              actorUserId: null,
              entityType: "EVENT",
              entityId: String(event?.id),
              actionUrl: `/home/events?event_id=${event?.id}`,
              priority: "HIGH",
              dedupeKey: `event:${event?.id}:reminder:${reminder.id}:recipient:${recipientUserId}`,
              sendSms,
              smsBody: sendSms
                ? `Reminder: "${eventName}" ${label}.`
                : undefined,
            })),
          );
        }

        // Mark as SENT regardless of whether there were recipients, so the
        // row doesn't get re-processed.
        await prisma.event_reminder.update({
          where: { id: reminder.id },
          data: { status: "SENT" },
        });
      } catch (innerError: any) {
        console.error(
          `[ERROR] Failed to process reminder ${reminder.id}:`,
          innerError?.message,
        );

        await prisma.event_reminder.update({
          where: { id: reminder.id },
          data: { status: "FAILED" },
        });
      }
    }

    console.info("[INFO] Event reminder job completed", {
      processed: dueReminders.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error("[ERROR] Event reminder job failed:", normalizedError);

    await notificationService.notifyAdminsJobFailed({
      jobName: "event-reminder-processing",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:event-reminder-processing:${new Date()
        .toISOString()
        .slice(0, 13)}`,
    });
  } finally {
    isReminderJobRunning = false;
  }
}

// Fire every minute.
cron.schedule("* * * * *", async () => {
  await processEventRemindersJob();
});

// Run once at startup to catch any reminders that fired while the server was
// down.
void processEventRemindersJob();
