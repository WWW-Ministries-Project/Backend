import { Router } from "express";
import attendanceTimingSettingsController from "./attendanceTimingSettingsController";
import eventReportExclusionController from "./eventReportExclusionController";
import reportConfigController from "./reportConfigController";
import visitorFollowUpSettingsController from "./visitorFollowUpSettingsController";
import roleEligibilityController from "./roleEligibilityController";
import systemNotificationSettingsController from "./systemNotificationSettingsController";
import { Permissions } from "../../middleWare/authorization";
import { CONFIGURE_GENERAL, CONFIGURE_REPORTS, requireOrgWide } from "./orgWideAccess";
import {
  requireAttendanceActionOrLegacySettings,
  requireAttendanceOrSettingsView,
} from "../events/attendanceAccess";

const settingsRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

settingsRouter.get(
  "/attendance-timing-config",
  // Arrival windows are needed by anyone reading attendance.
  [protect, permissions.withAccess, requireAttendanceOrSettingsView],
  attendanceTimingSettingsController.getConfig,
);

settingsRouter.post(
  "/upsert-attendance-timing-config",
  // Moved from Settings to Church attendance (configure_timing); roles saved
  // before actions existed keep Settings manage.
  [
    protect,
    permissions.withAccess,
    requireAttendanceActionOrLegacySettings(
      ["configure_timing"],
      "manage",
      "Not authorized to change attendance timing",
    ),
  ],
  attendanceTimingSettingsController.upsertConfig,
);

settingsRouter.get(
  "/event-report-exclusions",
  [protect, permissions.can_view_settings],
  eventReportExclusionController.list,
);

// Org-wide settings below need the right in every branch (orgWideAccess.ts).
settingsRouter.post(
  "/upsert-event-report-exclusions",
  requireOrgWide(CONFIGURE_REPORTS, "Not authorized to change report settings"),
  eventReportExclusionController.replace,
);

settingsRouter.get(
  "/report-config",
  [protect, permissions.can_view_settings],
  reportConfigController.getConfig,
);

settingsRouter.post(
  "/upsert-report-config",
  requireOrgWide(CONFIGURE_REPORTS, "Not authorized to change report settings"),
  reportConfigController.upsertConfig,
);

settingsRouter.get(
  "/get-role-eligibility-config",
  [protect, permissions.can_view_settings],
  roleEligibilityController.getConfig,
);

settingsRouter.post(
  "/upsert-role-eligibility-config",
  requireOrgWide(CONFIGURE_GENERAL, "Not authorized to change general configuration"),
  roleEligibilityController.upsertConfig,
);

// Logs: who hears about system failures.
settingsRouter.get(
  "/system-notification-config",
  [protect, permissions.requireAction("Settings", "view_logs", "Not authorized to view logs")],
  systemNotificationSettingsController.getConfig,
);

settingsRouter.get(
  "/system-notification-admins",
  [protect, permissions.requireAction("Settings", "view_logs", "Not authorized to view logs")],
  systemNotificationSettingsController.listAdminCandidates,
);

settingsRouter.post(
  "/upsert-system-notification-config",
  requireOrgWide(CONFIGURE_GENERAL, "Not authorized to change general configuration"),
  systemNotificationSettingsController.upsertConfig,
);

settingsRouter.get(
  "/visitor-follow-up-config",
  [protect, permissions.can_view_settings],
  visitorFollowUpSettingsController.getConfig,
);

settingsRouter.post(
  "/upsert-visitor-follow-up-config",
  requireOrgWide(CONFIGURE_GENERAL, "Not authorized to change general configuration"),
  visitorFollowUpSettingsController.upsertConfig,
);

export default settingsRouter;
