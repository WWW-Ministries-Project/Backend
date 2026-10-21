import Router from "express";

import { Permissions } from "../../middleWare/authorization";
import {
  addCommentHandler,
  approveReportHandler,
  decideRequestHandler,
  executiveSummaryHandler,
  getDepartmentReportHandler,
  listDepartmentReportsHandler,
  returnReportHandler,
  saveCommentaryHandler,
  sendReminderHandler,
  submitReportHandler,
} from "./departmentReportController";

/**
 * Department reports and the executive summary. Each report reads a different
 * module, so per-report access (domain view / manage, Reports view / admin) is
 * checked in the service; the guards here only require a signed-in user.
 * Contract: Frontend/docs/DEPARTMENT_REPORTS_BACKEND_CONTRACT.md
 */
export const departmentReportRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

departmentReportRouter.get("/list", [protect], listDepartmentReportsHandler);
departmentReportRouter.get("/report", [protect], getDepartmentReportHandler);
departmentReportRouter.get("/executive-summary", [protect, permissions.can_view_reports], executiveSummaryHandler);

departmentReportRouter.put("/commentary", [protect], saveCommentaryHandler);
departmentReportRouter.post("/submit", [protect], submitReportHandler);
departmentReportRouter.post("/approve", [protect, permissions.can_admin_reports], approveReportHandler);
departmentReportRouter.post("/return", [protect, permissions.can_admin_reports], returnReportHandler);
departmentReportRouter.post("/comment", [protect], addCommentHandler);
departmentReportRouter.post("/remind", [protect, permissions.can_admin_reports], sendReminderHandler);
departmentReportRouter.post("/requests/decide", [protect, permissions.can_admin_reports], decideRequestHandler);
