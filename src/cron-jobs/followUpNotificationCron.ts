import cron from "node-cron";
import { prisma } from "../Models/context";
import { notificationService } from "../modules/notifications/notificationService";

let isFollowUpNotificationJobRunning = false;

const isPositiveInt = (value: unknown): value is number =>
  Number.isInteger(Number(value)) && Number(value) > 0;

const getStartOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export async function processFollowUpDueNotificationsJob() {
  if (isFollowUpNotificationJobRunning) {
    return;
  }

  isFollowUpNotificationJobRunning = true;

  try {
    const now = new Date();
    const startOfToday = getStartOfDay(now);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const dayKey = startOfToday.toISOString().slice(0, 10);

    const [dueFollowUps, overdueFollowUps] = await Promise.all([
      prisma.follow_up.findMany({
        where: {
          assignedTo: {
            not: null,
          },
          date: {
            gte: startOfToday,
            lt: startOfTomorrow,
          },
          status: {
            notIn: ["completed", "cancelled", "done"],
          },
        },
        select: {
          id: true,
          assignedTo: true,
          visitorId: true,
          date: true,
        },
      }),
      prisma.follow_up.findMany({
        where: {
          assignedTo: {
            not: null,
          },
          date: {
            lt: startOfToday,
          },
          status: {
            notIn: ["completed", "cancelled", "done"],
          },
        },
        select: {
          id: true,
          assignedTo: true,
          visitorId: true,
          date: true,
        },
      }),
    ]);

    const dueNotifications = dueFollowUps
      .filter((followUp) => isPositiveInt(followUp.assignedTo))
      .map((followUp) => ({
        type: "follow_up.due",
        title: "Follow-up due today",
        body: "A visitor follow-up assigned to you is due today.",
        recipientUserId: Number(followUp.assignedTo),
        actorUserId: null,
        entityType: "VISITOR_FOLLOW_UP",
        entityId: String(followUp.id),
        actionUrl: `/home/visitors/visitor/${followUp.visitorId}`,
        priority: "HIGH" as const,
        dedupeKey: `follow-up:${followUp.id}:due:${dayKey}:recipient:${followUp.assignedTo}`,
      }));

    const overdueNotifications = overdueFollowUps
      .filter((followUp) => isPositiveInt(followUp.assignedTo))
      .map((followUp) => ({
        type: "follow_up.overdue",
        title: "Follow-up overdue",
        body: "A visitor follow-up assigned to you is overdue and needs attention.",
        recipientUserId: Number(followUp.assignedTo),
        actorUserId: null,
        entityType: "VISITOR_FOLLOW_UP",
        entityId: String(followUp.id),
        actionUrl: `/home/visitors/visitor/${followUp.visitorId}`,
        priority: "HIGH" as const,
        dedupeKey: `follow-up:${followUp.id}:overdue:${dayKey}:recipient:${followUp.assignedTo}`,
      }));

    if (dueNotifications.length || overdueNotifications.length) {
      await notificationService.createManyInAppNotifications([
        ...dueNotifications,
        ...overdueNotifications,
      ]);
    }
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Follow-up due/overdue notification processing failed:",
      normalizedError,
    );

    await notificationService.notifyAdminsJobFailed({
      jobName: "follow-up-due-overdue-notifications",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:follow-up-due-overdue:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isFollowUpNotificationJobRunning = false;
  }
}

cron.schedule("0 * * * *", async () => {
  await processFollowUpDueNotificationsJob();
});

