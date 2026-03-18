import { Router } from "express";
import attendanceTimingSettingsController from "./attendanceTimingSettingsController";
import roleEligibilityController from "./roleEligibilityController";
import systemNotificationSettingsController from "./systemNotificationSettingsController";
import { Permissions } from "../../middleWare/authorization";

const settingsRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

settingsRouter.get(
  "/attendance-timing-config",
  [protect, permissions.can_view_settings],
  attendanceTimingSettingsController.getConfig,
);

settingsRouter.post(
  "/upsert-attendance-timing-config",
  [protect, permissions.can_manage_settings],
  attendanceTimingSettingsController.upsertConfig,
);

settingsRouter.get(
  "/get-role-eligibility-config",
  [protect, permissions.can_view_settings],
  roleEligibilityController.getConfig,
);

settingsRouter.post(
  "/upsert-role-eligibility-config",
  [protect, permissions.can_manage_settings],
  roleEligibilityController.upsertConfig,
);

settingsRouter.get(
  "/system-notification-config",
  [protect, permissions.can_view_settings],
  systemNotificationSettingsController.getConfig,
);

settingsRouter.get(
  "/system-notification-admins",
  [protect, permissions.can_view_settings],
  systemNotificationSettingsController.listAdminCandidates,
);

settingsRouter.post(
  "/upsert-system-notification-config",
  [protect, permissions.can_manage_settings],
  systemNotificationSettingsController.upsertConfig,
);

export default settingsRouter;
