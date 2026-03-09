import cron from "node-cron";
import { prisma } from "../Models/context";
import { UserService } from "../modules/user/userService";

const userService = new UserService();
const USER_SYNC_CONCURRENCY = (() => {
  const parsed = Number(process.env.USER_SYNC_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 5;
  }

  return Math.min(parsed, 20);
})();

let isRunning = false;

export async function startUserSyncing() {
  if (isRunning) {
    console.log("[INFO] Sync already in progress, skipping execution.");
    return;
  }

  isRunning = true;

  try {
    // Get all users that need syncing
    const users = await prisma.user.findMany({
      where: {
        is_sync: false,
      },
    });

    if (users.length === 0) {
      return;
    }
    console.log(`[INFO] Found ${users.length} users to sync.`);

    const syncUser = async (user: any) => {
      try {
        let response;
        const year = new Date().getFullYear();
        const paddedId = user.id.toString().padStart(4, "0");
        const userId = user.member_id
          ? user.member_id.slice(-8)
          : `${year}${paddedId}`;
        response = await userService.saveUserToZTeco(
          user.id,
          userId,
          user.name,
          "",
        );
        if (response) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              is_sync: true,
            },
          });
          console.log(`[INFO] Successfully synced user ${user.id}`);
        }
      } catch (error: any) {
        console.error(
          `[ERROR] Failed to sync users ${user.name}:`,
          error.message || error,
        );
      }
    };

    for (let index = 0; index < users.length; index += USER_SYNC_CONCURRENCY) {
      const chunk = users.slice(index, index + USER_SYNC_CONCURRENCY);
      await Promise.allSettled(chunk.map((user: any) => syncUser(user)));
    }
  } catch (error: any) {
    console.error(
      "[ERROR] Error fetching users for sync:",
      error.message || error,
    );
  } finally {
    isRunning = false;
  }
}
cron.schedule("50 * * * * *", async () => {
  await startUserSyncing();
});
