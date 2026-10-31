import Router from "express";
import * as dotenv from "dotenv";
import {} from "../../utils/";
import {
  saveRequisitionApprovalConfigHandler,
  getRequisitionApprovalConfigHandler,
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
  requisitionApprovalActionHandler,
  preApprovalSimilarItemsHandler,
  submitRequisitionHandler,
  updateRequisitionHandler,
  deleteRequisitionHandler,
  userRequisitionsHandler,
  staffRequestHandler,
  requisitionOverviewHandler,
  requisitionOverviewDetailHandler,
  sendRequisitionReminderHandler,
  requisitionAnalyticsHandler,
  addRequisitionCommentHandler,
  markRequisitionDisbursedHandler,
} from "./requisitionsController";

import { Permissions } from "../../middleWare/authorization";
import { requisitionLogger } from "../../utils/loggers";
import { wrapControllersWithLogger } from "../../utils/catchAsyncFunction";
const permissions = new Permissions();
dotenv.config();

export const requisitionRouter = Router();

const requisitionControllers = {
  saveRequisitionApprovalConfigHandler,
  getRequisitionApprovalConfigHandler,
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
  requisitionApprovalActionHandler,
  preApprovalSimilarItemsHandler,
  submitRequisitionHandler,
  updateRequisitionHandler,
  deleteRequisitionHandler,
  userRequisitionsHandler,
  staffRequestHandler,
  requisitionOverviewHandler,
  requisitionOverviewDetailHandler,
  sendRequisitionReminderHandler,
  requisitionAnalyticsHandler,
  addRequisitionCommentHandler,
  markRequisitionDisbursedHandler,
};

// Wrap controllers with logger
const wrappedControllers = wrapControllersWithLogger(
  requisitionControllers,
  requisitionLogger,
);

requisitionRouter.post(
  "/upsert-approval-config",
  [
    permissions.protect,
    permissions.requireAction(
      "Requisition",
      "configure_approvals",
      "Not authorized to change the requisition approval chain",
    ),
  ],
  wrappedControllers.saveRequisitionApprovalConfigHandler,
);
requisitionRouter.get(
  "/get-approval-config",
  [permissions.protect, permissions.can_view_requisitions],
  wrappedControllers.getRequisitionApprovalConfigHandler,
);
requisitionRouter.post(
  "/create-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.createRequisitionHandler,
);
requisitionRouter.post(
  "/submit-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.submitRequisitionHandler,
);
// Approver-only: the service allows the current step's approver, or a role
// with Requisition.override_step within its scope. Being an approver
// somewhere no longer opens other Requisition routes.
requisitionRouter.post(
  "/approval-action",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.requisitionApprovalActionHandler,
);
requisitionRouter.get(
  "/pre-approval-similar-items",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.preApprovalSimilarItemsHandler,
);
requisitionRouter.get(
  "/list-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.listRequisitionHandler,
);
requisitionRouter.get(
  "/my-requisitions",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.userRequisitionsHandler,
);
requisitionRouter.get(
  "/get-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.getRequisitionHandler,
);
requisitionRouter.put(
  "/update-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.updateRequisitionHandler,
);
requisitionRouter.delete(
  "/delete-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.deleteRequisitionHandler,
);
// Submitted requisitions within the caller's Requisition scope (the whole
// branch for a branch-scoped role) plus those with a step assigned to them.
requisitionRouter.get(
  "/staff-requisition",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.staffRequestHandler,
);

// Redesign: overview list (scope=mine|all, scoped in the service), drawer
// detail, manual reminders and analytics. See
// docs/REQUISITIONS_REDESIGN_FRONTEND_GUIDE.md.
requisitionRouter.get(
  "/overview",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.requisitionOverviewHandler,
);
requisitionRouter.get(
  "/overview-detail",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.requisitionOverviewDetailHandler,
);
requisitionRouter.post(
  "/send-reminder",
  [
    permissions.protect,
    permissions.requireAction(
      "Requisition",
      "send_reminders",
      "Not authorized to send requisition reminders",
    ),
  ],
  wrappedControllers.sendRequisitionReminderHandler,
);
requisitionRouter.get(
  "/analytics",
  [permissions.protect, permissions.can_view_requisitions],
  wrappedControllers.requisitionAnalyticsHandler,
);
requisitionRouter.post(
  "/add-comment",
  [permissions.protect, permissions.withAccess],
  wrappedControllers.addRequisitionCommentHandler,
);
requisitionRouter.post(
  "/mark-disbursed",
  [
    permissions.protect,
    permissions.requireAction(
      "Requisition",
      "mark_disbursed",
      "Not authorized to mark requisitions disbursed",
    ),
  ],
  wrappedControllers.markRequisitionDisbursedHandler,
);
