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
import { requireEventReportRight } from "./eventReportAccess";

export const eventReportRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

// Event reports are a Reports module: each route needs its Reports action,
// or the Events level it needed before for roles saved before actions.
const canRead = requireEventReportRight("read", "Not authorized to view event reports");

eventReportRouter.get("/eligible-events", canRead, listEligibleEventReportsHandler);

eventReportRouter.post(
  "/generate",
  requireEventReportRight("generate", "Not authorized to generate event reports"),
  generateEventReportHandler,
);

eventReportRouter.get("/overview", canRead, getEventReportOverviewHandler);

eventReportRouter.get("/get-report", canRead, getEventReportDetailHandler);

eventReportRouter.post(
  "/generate-service-summary",
  requireEventReportRight("export", "Not authorized to export event reports"),
  generateServiceSummaryReportHandler,
);

eventReportRouter.get("/get-approval-config", canRead, getEventReportApprovalConfigHandler);

eventReportRouter.post(
  "/upsert-approval-config",
  requireEventReportRight(
    "configure_approvals",
    "Not authorized to change the event report approval chain",
  ),
  saveEventReportApprovalConfigHandler,
);

// Sign-off: the current step's approver in the configured chain (or Full on
// Reports), never the report's own generator. Decided in the service.
eventReportRouter.post("/approve", [protect, permissions.withAccess], approveEventReportHandler);

eventReportRouter.post("/return", [protect, permissions.withAccess], returnEventReportHandler);

eventReportRouter.post(
  "/resubmit",
  requireEventReportRight("generate", "Not authorized to resubmit event reports"),
  resubmitEventReportHandler,
);

eventReportRouter.post(
  "/comment",
  requireEventReportRight("comment", "Not authorized to comment on event reports"),
  commentOnEventReportHandler,
);
