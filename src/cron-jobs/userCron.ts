import cron from "node-cron";
import { ZKTeco } from "../modules/integrationUtils/userIntegration";
import { prisma } from "../Models/context";

const zkTeco = new ZKTeco();
const SYNC_API_HOST: any = process.env.ZKtecoHost;

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
        OR: [
          { is_sync: false },
          { sync_id: null },
        ],
      },
    });

    if (users.length === 0) {
 
      return;
    }
    console.log(`[INFO] Found ${users.length} users to sync.`);
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