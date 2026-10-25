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
 * module, so per-report access (module view / manage, the Reports actions and
 * scope) is checked in the service; the guards here only require a signed-in
 * user and load their live role (`req.access`).
 * Contract: Frontend/docs/DEPARTMENT_REPORTS_BACKEND_CONTRACT.md
 */
export const departmentReportRouter = Router();
const permissions = new Permissions();
const signedIn = [permissions.protect, permissions.withAccess];

departmentReportRouter.get("/list", signedIn, listDepartmentReportsHandler);
departmentReportRouter.get("/report", signedIn, getDepartmentReportHandler);
// Reports.exec_view
departmentReportRouter.get("/executive-summary", signedIn, executiveSummaryHandler);

departmentReportRouter.put("/commentary", signedIn, saveCommentaryHandler);
departmentReportRouter.post("/submit", signedIn, submitReportHandler);
// Reports.dept_approve (leadership), never on a report you submitted.
departmentReportRouter.post("/approve", signedIn, approveReportHandler);
departmentReportRouter.post("/return", signedIn, returnReportHandler);
departmentReportRouter.post("/comment", signedIn, addCommentHandler);
// Reports.dept_remind
departmentReportRouter.post("/remind", signedIn, sendReminderHandler);
// Reports.dept_decide_request or exec_decide
departmentReportRouter.post("/requests/decide", signedIn, decideRequestHandler);
