import cron from "node-cron";
import { prisma } from "../Models/context";
import { UserService } from "../modules/user/userService";

const userService = new UserService();

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

    await Promise.allSettled(
      users.map(async (user: any) => {
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
      }),
    );
  } catch (error: any) {
    console.error(
      "[ERROR] Error fetching users for sync:",
      error.message || error,
    );
  } finally {
    isRunning = false;
  }
}
cron.schedule("* * * * *", async () => {
  await startUserSyncing();
});
