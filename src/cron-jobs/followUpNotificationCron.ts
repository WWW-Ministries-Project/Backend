import cron from "node-cron";
import { addDays, startOfDay } from "date-fns";
import { prisma } from "../Models/context";
import {
  notificationService,
  type CreateNotificationInput,
} from "../modules/notifications/notificationService";

let isFollowUpNotificationJobRunning = false;

const FOLLOW_UP_QUERY_BATCH_SIZE = (() => {
  const parsed = Number(process.env.FOLLOW_UP_NOTIFICATION_QUERY_BATCH_SIZE);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 250;
  }
  return Math.min(parsed, 2000);
})();

const FOLLOW_UP_WRITE_BATCH_SIZE = (() => {
  const parsed = Number(process.env.FOLLOW_UP_NOTIFICATION_WRITE_BATCH_SIZE);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 200;
  }
  return Math.min(parsed, 1000);
})();

const FOLLOW_UP_MAX_ROWS_PER_WINDOW = (() => {
  const parsed = Number(process.env.FOLLOW_UP_NOTIFICATION_MAX_ROWS_PER_WINDOW);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 5000;
  }
  return Math.min(parsed, 20000);
})();

const ACTIVE_FOLLOW_UP_STATUSES_EXCLUSION = ["completed", "cancelled", "done"];
const FOLLOW_UP_NOTIFICATION_CRON =
  process.env.FOLLOW_UP_NOTIFICATION_CRON || "10 23 * * *";

const toPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (!items.length) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

type FollowUpRow = {
  id: number;
  assignedTo: number | null;
  visitorId: number;
  date: Date;
};

const processFollowUpWindowNotifications = async (args: {
  window: "due" | "overdue";
  dayKey: string;
  dateFilter: {
    gte?: Date;
    lt?: Date;
  };
}) => {
  let cursorId: number | null = null;
  let scannedRows = 0;
  let createdNotifications = 0;

  while (scannedRows < FOLLOW_UP_MAX_ROWS_PER_WINDOW) {
    const remaining = FOLLOW_UP_MAX_ROWS_PER_WINDOW - scannedRows;
    const take = Math.min(FOLLOW_UP_QUERY_BATCH_SIZE, remaining);

    const rows: FollowUpRow[] = await prisma.follow_up.findMany({
      where: {
        assignedTo: {
          not: null,
        },
        date: args.dateFilter,
        status: {
          notIn: ACTIVE_FOLLOW_UP_STATUSES_EXCLUSION,
        },
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: {
        id: "asc",
      },
      take,
      select: {
        id: true,
        assignedTo: true,
        visitorId: true,
        date: true,
      },
    });

    if (!rows.length) {
      break;
    }

    scannedRows += rows.length;
    cursorId = rows[rows.length - 1].id;

    const notifications: CreateNotificationInput[] = rows.flatMap((followUp) => {
      const recipientUserId = toPositiveInt(followUp.assignedTo);
      if (!recipientUserId) {
        return [];
      }

      return [
        {
          type: args.window === "due" ? "follow_up.due" : "follow_up.overdue",
          title:
            args.window === "due" ? "Follow-up due today" : "Follow-up overdue",
          body:
            args.window === "due"
              ? "A visitor follow-up assigned to you is due today."
              : "A visitor follow-up assigned to you is overdue and needs attention.",
          recipientUserId,
          actorUserId: null,
          entityType: "VISITOR_FOLLOW_UP" as const,
          entityId: String(followUp.id),
          actionUrl: `/home/visitors/visitor/${followUp.visitorId}`,
          priority: "HIGH" as const,
          dedupeKey: `follow-up:${followUp.id}:${args.window}:${args.dayKey}:recipient:${recipientUserId}`,
        },
      ];
    });

    for (const notificationBatch of chunkArray(
      notifications,
      FOLLOW_UP_WRITE_BATCH_SIZE,
    )) {
      if (!notificationBatch.length) {
        continue;
      }

      await notificationService.createManyInAppNotifications(notificationBatch);
      createdNotifications += notificationBatch.length;
    }
  }

  return {
    scannedRows,
    createdNotifications,
    hitWindowLimit: scannedRows >= FOLLOW_UP_MAX_ROWS_PER_WINDOW,
  };
};

export async function processFollowUpDueNotificationsJob() {
  if (isFollowUpNotificationJobRunning) {
    return;
  }

  isFollowUpNotificationJobRunning = true;

  try {
    const now = new Date();
    const startOfToday = startOfDay(now);
    const startOfTomorrow = addDays(startOfToday, 1);
    const dayKey = startOfToday.toISOString().slice(0, 10);

    const [dueResult, overdueResult] = await Promise.all([
      processFollowUpWindowNotifications({
        window: "due",
        dayKey,
        dateFilter: {
          gte: startOfToday,
          lt: startOfTomorrow,
        },
      }),
      processFollowUpWindowNotifications({
        window: "overdue",
        dayKey,
        dateFilter: {
          lt: startOfToday,
        },
      }),
    ]);

    console.info("[INFO] Follow-up due/overdue notification job:", {
      due: dueResult,
      overdue: overdueResult,
    });

    if (dueResult.hitWindowLimit || overdueResult.hitWindowLimit) {
      console.warn(
        "[WARN] Follow-up notification window limit reached; increase FOLLOW_UP_NOTIFICATION_MAX_ROWS_PER_WINDOW if needed.",
      );
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

// Daily in off-peak window (11pm-1am), server timezone.
cron.schedule(FOLLOW_UP_NOTIFICATION_CRON, async () => {
  await processFollowUpDueNotificationsJob();
});
