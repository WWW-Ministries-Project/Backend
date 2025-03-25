import cron from "node-cron";
import { prisma } from "../Models/context";
import { ZKTecoPosition } from "../modules/integrationUtils/positionIntegration";
import { ZKTecoAuth } from "../modules/integrationUtils/authenticationIntegration";

const zkTeco = new ZKTecoPosition();
const SYNC_API_HOST: any = process.env.ZKtecoHost;
const zkTecoAuth = new ZKTecoAuth();

let isRunning = false;

export const syncPositions = async () => {
  if (isRunning) {
    return;
  }

  isRunning = true;
  try {
    console.log("[INFO] Fetching out-of-sync positions...");

    const positions = await prisma.position.findMany({
        where: {
            OR: [
              { is_sync: false },
              { sync_id: null },
            ],
          },
    });

    if (positions.length === 0) {
      return;
    }

    console.log(`[INFO] Found ${positions.length} positions to sync.`);

    // Authenticate once
    const authResponse = await zkTecoAuth.userAuthentication();
    if (!authResponse?.token) throw new Error("Failed to authenticate with ZKTeco");
    
    const token = authResponse.token;

    await Promise.allSettled(
        positions.map(async (position:any) => {
        try {
          let response;

          if (!position.sync_id) {
            
            response = await zkTeco.createPosition(
              { position_name: position.name, position_code: position.id.toString() },
              token
            );
          } else {
            console.log(`[INFO] Updating existing positions: ${position.id}`);
            response = await zkTeco.updatePosition(
                position.sync_id,
              { position_name: position.name, position_code: position.id.toString() },
              token
            );
          }

          if (response?.id) {
            await prisma.position.update({
              where: { id: position.id },
              data: { is_sync: true, sync_id: response.id },
            });
            console.log(`[INFO] Successfully synced department ${position.id} with sync_id: ${response.id}`);
          } else {
            console.warn(`[WARN] No syncId returned for department ${position.id}.`);
          }
        } catch (error: any) {
          console.error(`[ERROR] Failed to sync department ${position.id}:`, error.message || error);
        }
      })
    );
  } catch (error: any) {
    console.error("[ERROR] Error syncing departments:", error.message || error);
  } finally {
    isRunning = false;
  }
};

// Run the cron job every minute
cron.schedule("* * * * *", syncPositions);