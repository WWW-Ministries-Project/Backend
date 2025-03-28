import cron from "node-cron";
import { prisma } from "../Models/context";
import { ZKTecoDepartment } from "../modules/integrationUtils/departmentIntegration";
import { ZKTecoAuth } from "../modules/integrationUtils/authenticationIntegration";

const zkTeco = new ZKTecoDepartment();
const zkTecoAuth = new ZKTecoAuth();

const SYNC_API_HOST: any = process.env.ZKtecoHost;

let isRunning = false;

export const syncDepartments = async () => {
  if (isRunning) {
    console.log("[INFO] Sync already in progress, skipping execution.");
    return;
  }

  isRunning = true;
  try {
    const departments = await prisma.department.findMany({
        where: {
            OR: [
              { is_sync: false },
              { sync_id: null },
            ],
          },
    });

    if (departments.length === 0) {
      return;
    }

    console.log(`[INFO] Found ${departments.length} departments to sync.`);

    // Authenticate once
    const authResponse = await zkTecoAuth.userAuthentication();
    if (!authResponse?.token) throw new Error("Failed to authenticate with ZKTeco");
    
    const token = authResponse.token;

    await Promise.allSettled(
      departments.map(async (department:any) => {
        try {
          console.log(`[INFO] Syncing department: ${department.id}`);
          let response;

          if (!department.sync_id) {
            console.log(`[INFO] Creating new department: ${department.id}`);
            response = await zkTeco.createDepartment(
              { dept_name: department.name, dept_code: department.id.toString() },
              token
            );
          } else {
            console.log(`[INFO] Updating existing department: ${department.id}`);
            response = await zkTeco.updateDepartment(
              department.sync_id,
              { dept_name: department.name, dept_code: department.id.toString() },
              token
            );
          }

          if (response?.id) {
            await prisma.department.update({
              where: { id: department.id },
              data: { is_sync: true, sync_id: response.id },
            });
            console.log(`[INFO] Successfully synced department ${department.id} with sync_id: ${response.id}`);
          } else {
            console.warn(`[WARN] No syncId returned for department ${department.id}.`);
          }
        } catch (error: any) {
          console.error(`[ERROR] Failed to sync department ${department.id}:`, error.message || error);
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
cron.schedule("* * * * *", syncDepartments);