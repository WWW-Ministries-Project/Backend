import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import {
  churchAttendanceApprovalActionHandler,
  departmentApprovalActionHandler,
  finalApprovalActionHandler,
  financeApprovalActionHandler,
  getEventReportApprovalConfigHandler,
  getEventReportDetailHandler,
  saveEventReportApprovalConfigHandler,
  submitFinalApprovalHandler,
  upsertEventReportFinanceHandler,
} from "./eventReportController";

export const eventReportRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

eventReportRouter.post(
  "/upsert-approval-config",
  [protect, permissions.can_manage_events],
  saveEventReportApprovalConfigHandler,
);

eventReportRouter.get(
  "/get-approval-config",
  [protect, permissions.can_view_events],
  getEventReportApprovalConfigHandler,
);

eventReportRouter.get("/get-report", [protect], getEventReportDetailHandler);

eventReportRouter.post(
  "/upsert-finance",
  [protect],
  upsertEventReportFinanceHandler,
);

eventReportRouter.post(
  "/department-approval-action",
  [protect],
  departmentApprovalActionHandler,
);

eventReportRouter.post(
  "/church-attendance-approval-action",
  [protect],
  churchAttendanceApprovalActionHandler,
);

eventReportRouter.post(
  "/finance-approval-action",
  [protect],
  financeApprovalActionHandler,
);

eventReportRouter.post(
  "/submit-final-approval",
  [protect],
  submitFinalApprovalHandler,
);

eventReportRouter.post(
  "/final-approval-action",
  [protect],
  finalApprovalActionHandler,
);
