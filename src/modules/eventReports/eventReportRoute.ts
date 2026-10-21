import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import {
  approveEventReportHandler,
  commentOnEventReportHandler,
  resubmitEventReportHandler,
  returnEventReportHandler,
  generateEventReportHandler,
  generateServiceSummaryReportHandler,
  getEventReportDetailHandler,
  getEventReportApprovalConfigHandler,
  getEventReportOverviewHandler,
  listEligibleEventReportsHandler,
  saveEventReportApprovalConfigHandler,
} from "./eventReportController";

export const eventReportRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

eventReportRouter.get(
  "/eligible-events",
  [protect, permissions.can_view_events],
  listEligibleEventReportsHandler,
);

eventReportRouter.post(
  "/generate",
  [protect, permissions.can_manage_events],
  generateEventReportHandler,
);

eventReportRouter.get(
  "/overview",
  [protect, permissions.can_view_events],
  getEventReportOverviewHandler,
);

eventReportRouter.get(
  "/get-report",
  [protect, permissions.can_view_events],
  getEventReportDetailHandler,
);

eventReportRouter.post(
  "/generate-service-summary",
  [protect, permissions.can_view_events],
  generateServiceSummaryReportHandler,
);

eventReportRouter.get(
  "/get-approval-config",
  [protect, permissions.can_view_events],
  getEventReportApprovalConfigHandler,
);

eventReportRouter.post(
  "/upsert-approval-config",
  [protect, permissions.can_manage_events],
  saveEventReportApprovalConfigHandler,
);

// Sign-off: Reports admin OR Events admin, enforced in the handler (403).
eventReportRouter.post("/approve", [protect], approveEventReportHandler);

eventReportRouter.post("/return", [protect], returnEventReportHandler);

eventReportRouter.post(
  "/resubmit",
  [protect, permissions.can_manage_events],
  resubmitEventReportHandler,
);

eventReportRouter.post(
  "/comment",
  [protect, permissions.can_view_events],
  commentOnEventReportHandler,
);
