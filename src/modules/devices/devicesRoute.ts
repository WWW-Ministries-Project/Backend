import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { DeviceController } from "./deviceController";

const permissions = new Permissions();
const protect = permissions.protect;

const deviceRouter = Router();
const deviceController = new DeviceController();

//life center roles
deviceRouter.post(
  "/create-devices",
  [protect, permissions.can_manage_settings],
  deviceController.createDevices,
);
deviceRouter.get(
  "/get-devices",
  [protect, permissions.can_view_settings],
  deviceController.getAllDevices,
);
deviceRouter.get(
  "/get-device",
  [protect, permissions.can_view_settings],
  deviceController.getDevicesById,
);
deviceRouter.put(
  "/update-device",
  [protect, permissions.can_manage_settings],
  deviceController.updateLifeCenter,
);
deviceRouter.delete(
  "/delete-device",
  [protect, permissions.can_delete_settings],
  deviceController.deleteDevices,
);

export default deviceRouter;
