import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "../Models/context";
import { notificationService } from "../modules/notifications/notificationService";
import { UserService } from "../modules/user/userService";

const userService = new UserService();

const USER_SYNC_CONCURRENCY = (() => {
  const parsed = Number(process.env.USER_SYNC_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 5;
  }

  return Math.min(parsed, 20);
})();

const USER_SYNC_FETCH_BATCH_SIZE = (() => {
  const parsed = Number(process.env.USER_SYNC_FETCH_BATCH_SIZE);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 200;
  }

  return Math.min(parsed, 2000);
})();
const USER_SYNC_CRON = process.env.USER_SYNC_CRON || "20 0 * * *";

type PendingUserSyncRow = Prisma.userGetPayload<{
  select: {
    id: true;
    name: true;
    member_id: true;
  };
}>;

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

let isUserSyncJobRunning = false;

export async function startUserSyncing() {
  if (isUserSyncJobRunning) {
    console.log("[INFO] Sync already in progress, skipping execution.");
    return;
  }

  isUserSyncJobRunning = true;

  try {
    if (
      !process.env.SAVE_TO_ZKDEVICE ||
      process.env.SAVE_TO_ZKDEVICE === "false"
    ) {
      console.info("[INFO] User sync skipped: SAVE_TO_ZKDEVICE is disabled.");
      return;
    }

    if (!process.env.ZTECO_SERVICE) {
      console.warn("[WARN] User sync skipped: ZTECO_SERVICE is not configured.");
      return;
    }

    let cursorId = 0;
    let totalFetched = 0;
    let totalAttempted = 0;
    let totalSynced = 0;
    let totalFailed = 0;
    const sampleFailureMessages: string[] = [];

    const syncUser = async (
      user: PendingUserSyncRow,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const year = new Date().getFullYear();
        const paddedId = user.id.toString().padStart(4, "0");
        const userId = user.member_id
          ? user.member_id.slice(-8)
          : `${year}${paddedId}`;

        const response = await userService.saveUserToZTeco(
          user.id,
          userId,
          user.name,
          "",
        );

        if (response === false) {
          return { ok: false, error: `ZTeco sync returned false for user ${user.id}` };
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            is_sync: true,
          },
        });

        console.log(`[INFO] Successfully synced user ${user.id}`);
        return { ok: true };
      } catch (error: any) {
        const normalizedError = error?.message || String(error);
        console.error(
          `[ERROR] Failed to sync user ${user.name} (${user.id}):`,
          normalizedError,
        );
        return { ok: false, error: normalizedError };
      }
    };

    while (true) {
      const users = await prisma.user.findMany({
        where: {
          is_sync: false,
          id: {
            gt: cursorId,
          },
        },
        orderBy: {
          id: "asc",
        },
        take: USER_SYNC_FETCH_BATCH_SIZE,
        select: {
          id: true,
          name: true,
          member_id: true,
        },
      });

      if (!users.length) {
        break;
      }

      totalFetched += users.length;
      cursorId = users[users.length - 1].id;

      for (const chunk of chunkArray(users, USER_SYNC_CONCURRENCY)) {
        const outcomes = await Promise.all(chunk.map((user) => syncUser(user)));
        totalAttempted += outcomes.length;

        for (const outcome of outcomes) {
          if (outcome.ok) {
            totalSynced += 1;
            continue;
          }

          totalFailed += 1;
          if (
            outcome.error &&
            sampleFailureMessages.length < 5 &&
            !sampleFailureMessages.includes(outcome.error)
          ) {
            sampleFailureMessages.push(outcome.error);
          }
        }
      }
    }

    console.info("[INFO] User sync job summary:", {
      fetched: totalFetched,
      attempted: totalAttempted,
      synced: totalSynced,
      failed: totalFailed,
      concurrency: USER_SYNC_CONCURRENCY,
      fetchBatchSize: USER_SYNC_FETCH_BATCH_SIZE,
    });

    if (totalFailed > 0) {
      const errorSummary = sampleFailureMessages.length
        ? sampleFailureMessages.join(" | ")
        : "Unknown sync error";
      await notificationService.notifyAdminsJobFailed({
        jobName: "user-sync",
        errorMessage: `${totalFailed}/${totalAttempted} user sync attempts failed. ${errorSummary}`.slice(
          0,
          1000,
        ),
        actionUrl: "/home/users",
        dedupeKey: `job:user-sync:${new Date().toISOString().slice(0, 13)}`,
      });
    }
  } catch (error: any) {
    const normalizedError = error?.message || String(error);
    console.error(
      "[ERROR] Error fetching users for sync:",
      normalizedError,
    );
    await notificationService.notifyAdminsJobFailed({
      jobName: "user-sync",
      errorMessage: normalizedError,
      actionUrl: "/home/users",
      dedupeKey: `job:user-sync:${new Date().toISOString().slice(0, 13)}`,
    });
  } finally {
    isUserSyncJobRunning = false;
  }
}
// Daily in off-peak window (11pm-1am), server timezone.
cron.schedule(USER_SYNC_CRON, async () => {
  await startUserSyncing();
});
