import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import {
  generateEventReportHandler,
  generateServiceSummaryReportHandler,
  getEventReportDetailHandler,
  getEventReportOverviewHandler,
  listEligibleEventReportsHandler,
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
