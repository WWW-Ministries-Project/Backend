import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { DeviceController } from "./deviceController";
import { requireAttendanceActionOrLegacySettings } from "../events/attendanceAccess";

const permissions = new Permissions();
const protect = permissions.protect;

const deviceRouter = Router();
const deviceController = new DeviceController();

// Biometric devices belong to Church attendance (manage_devices). Roles saved
// before actions existed keep the Settings levels they used before. Reading
// the list is also open to people who import check-ins, who pick devices.
const canReadDevices = [
  protect,
  permissions.withAccess,
  requireAttendanceActionOrLegacySettings(
    ["manage_devices", "import_biometric"],
    "view",
    "Not authorized to view devices",
  ),
];
const canManageDevices = [
  protect,
  permissions.withAccess,
  requireAttendanceActionOrLegacySettings(["manage_devices"], "manage", "Not authorized to manage devices"),
];
const canDeleteDevices = [
  protect,
  permissions.withAccess,
  requireAttendanceActionOrLegacySettings(["manage_devices"], "admin", "Not authorized to delete devices"),
];

deviceRouter.post(
  "/create-devices",
  canManageDevices,
  deviceController.createDevices,
);
deviceRouter.get(
  "/get-devices",
  canReadDevices,
  deviceController.getAllDevices,
);
deviceRouter.get(
  "/get-device",
  canReadDevices,
  deviceController.getDevicesById,
);
deviceRouter.put(
  "/update-device",
  canManageDevices,
  deviceController.updateLifeCenter,
);
deviceRouter.delete(
  "/delete-device",
  canDeleteDevices,
  deviceController.deleteDevices,
);

export default deviceRouter;
