import cron from "node-cron";
import { prisma } from "../Models/context";
import {
  notificationService,
  type CreateNotificationInput,
} from "../modules/notifications/notificationService";
import { visitorFollowUpSettingsService } from "../modules/settings/visitorFollowUpSettingsService";
import { parseResponsibleMemberIds } from "../modules/visitorManagement/visitorAccess";

let isVisitorFollowUpGenerationRunning = false;
const QUERY_BATCH_SIZE = 250;
const AUTO_FOLLOW_UP_TYPE = "auto_monthly";

// N due dates spread across the given month (UTC).
const spreadDates = (year: number, month0: number, n: number): Date[] => {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const step = daysInMonth / (n + 1);
  return Array.from({ length: n }, (_, i) => {
    const day = Math.max(1, Math.min(daysInMonth, Math.round(step * (i + 1))));
    return new Date(Date.UTC(year, month0, day, 9, 0, 0));
  });
};

export async function generateMonthlyVisitorFollowUps(): Promise<void> {
  if (isVisitorFollowUpGenerationRunning) {
    return;
  }
  isVisitorFollowUpGenerationRunning = true;

  try {
    const config = await visitorFollowUpSettingsService.getConfig();
    if (!config.enabled) {
      return;
    }
    const n = config.follow_ups_per_month;
    if (!Number.isInteger(n) || n <= 0) {
      return;
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month0 = now.getUTCMonth();
    const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`;
    const monthStart = new Date(Date.UTC(year, month0, 1));
    const monthEnd = new Date(Date.UTC(year, month0 + 1, 1));

    let unassignedCount = 0;
    let createdCount = 0;
    let cursorId: number | null = null;

    for (;;) {
      const visitors: { id: number; responsibleMembers: string | null }[] =
        await prisma.visitor.findMany({
          where: cursorId ? { id: { gt: cursorId } } : undefined,
          orderBy: { id: "asc" },
          take: QUERY_BATCH_SIZE,
          select: { id: true, responsibleMembers: true },
        });
      if (!visitors.length) {
        break;
      }
      cursorId = visitors[visitors.length - 1].id;

      for (const visitor of visitors) {
        const ids = parseResponsibleMemberIds(visitor.responsibleMembers);
        if (!ids.length) {
          unassignedCount += 1;
          continue;
        }

        // Idempotency: skip auto rows already present this month.
        const existing = await prisma.follow_up.count({
          where: {
            visitorId: visitor.id,
            type: AUTO_FOLLOW_UP_TYPE,
            date: { gte: monthStart, lt: monthEnd },
          },
        });
        if (existing >= n) {
          continue;
        }

        const toCreate = spreadDates(year, month0, n)
          .slice(existing)
          .map((date, i) => ({
            visitorId: visitor.id,
            assignedTo: ids[(existing + i) % ids.length],
            date,
            type: AUTO_FOLLOW_UP_TYPE,
            status: "pending",
            notes: `Auto-generated monthly follow-up (${monthKey})`,
          }));
        if (!toCreate.length) {
          continue;
        }

        await prisma.follow_up.createMany({ data: toCreate });
        createdCount += toCreate.length;

        const notifications: CreateNotificationInput[] = toCreate.map((f) => ({
          type: "follow_up.assigned",
          title: "New follow-up assigned",
          body: "A monthly visitor follow-up has been assigned to you.",
          recipientUserId: f.assignedTo,
          actorUserId: null,
          entityType: "VISITOR_FOLLOW_UP",
          entityId: String(visitor.id),
          actionUrl: `/home/visitors/visitor/${visitor.id}`,
          priority: "MEDIUM",
          dedupeKey: `follow-up-gen:${visitor.id}:${monthKey}:${f.assignedTo}:${f.date.getUTCDate()}`,
          sendSms: false,
        }));
        await notificationService.createManyInAppNotifications(notifications);
      }
    }

    if (unassignedCount > 0) {
      const managerIds =
        await notificationService.listUserIdsWithVisitorManageAccess();
      if (managerIds.length) {
        await notificationService.createManyInAppNotifications(
          managerIds.map((uid) => ({
            type: "follow_up.unassigned_digest",
            title: "Visitors need a responsible member",
            body: `${unassignedCount} visitor(s) have no responsible member for this month's follow-ups.`,
            recipientUserId: uid,
            actorUserId: null,
            entityType: "VISITOR",
            actionUrl: "/home/visitors",
            priority: "MEDIUM" as const,
            dedupeKey: `follow-up-unassigned:${monthKey}:${uid}`,
            sendSms: false,
          })),
        );
      }
    }

    console.info("[INFO] Visitor follow-up generation job:", {
      monthKey,
      createdCount,
      unassignedCount,
    });
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Visitor follow-up generation failed:",
      normalizedError,
    );

    await notificationService.notifyAdminsJobFailed({
      jobName: "visitor-follow-up-generation",
      errorMessage: normalizedError,
      actionUrl: "/home/notifications",
      dedupeKey: `job:visitor-follow-up-generation:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isVisitorFollowUpGenerationRunning = false;
  }
}

// Default: 01:00 on the 1st of each month (server timezone).
const CRON_EXPRESSION =
  process.env.VISITOR_FOLLOW_UP_GEN_CRON?.trim() || "0 1 1 * *";

if (cron.validate(CRON_EXPRESSION)) {
  cron.schedule(CRON_EXPRESSION, async () => {
    await generateMonthlyVisitorFollowUps();
  });
} else {
  console.warn(
    `[WARN] Skipping invalid VISITOR_FOLLOW_UP_GEN_CRON expression: ${CRON_EXPRESSION}`,
  );
}
