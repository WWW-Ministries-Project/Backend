import Router from "express";
import * as dotenv from "dotenv";
import {} from "../../utils/";
import {
  backfillApprovalInstancesHandler,
  saveRequisitionApprovalConfigHandler,
  getRequisitionApprovalConfigHandler,
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
  requisitionApprovalActionHandler,
  submitRequisitionHandler,
  updateRequisitionHandler,
  deleteRequisitionHandler,
  userRequisitionsHandler,
  staffRequestHandler,
} from "./requisitionsController";

import { Permissions } from "../../middleWare/authorization";
import { requisitionLogger } from "../../utils/loggers";
import { wrapControllersWithLogger } from "../../utils/catchAsyncFunction";
const permissions = new Permissions();
dotenv.config();

export const requisitionRouter = Router();

const requisitionControllers = {
  backfillApprovalInstancesHandler,
  saveRequisitionApprovalConfigHandler,
  getRequisitionApprovalConfigHandler,
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
  requisitionApprovalActionHandler,
  submitRequisitionHandler,
  updateRequisitionHandler,
  deleteRequisitionHandler,
  userRequisitionsHandler,
  staffRequestHandler,
};

// Wrap controllers with logger
const wrappedControllers = wrapControllersWithLogger(
  requisitionControllers,
  requisitionLogger,
);

requisitionRouter.post(
  "/upsert-approval-config",
  [permissions.protect, permissions.can_manage_requisitions],
  wrappedControllers.saveRequisitionApprovalConfigHandler,
);
requisitionRouter.post(
  "/backfill-approval-instances",
  [permissions.protect, permissions.can_manage_requisitions],
  wrappedControllers.backfillApprovalInstancesHandler,
);
requisitionRouter.get(
  "/get-approval-config",
  [permissions.protect, permissions.can_view_requisitions],
  wrappedControllers.getRequisitionApprovalConfigHandler,
);
requisitionRouter.post(
  "/create-requisition",
  wrappedControllers.createRequisitionHandler,
);
requisitionRouter.post(
  "/submit-requisition",
  [permissions.protect],
  wrappedControllers.submitRequisitionHandler,
);
requisitionRouter.post(
  "/approval-action",
  [permissions.protect, permissions.can_manage_requisitions],
  wrappedControllers.requisitionApprovalActionHandler,
);
requisitionRouter.get(
  "/list-requisition",
  wrappedControllers.listRequisitionHandler,
);
requisitionRouter.get(
  "/my-requisitions",
  wrappedControllers.userRequisitionsHandler,
);
requisitionRouter.get(
  "/get-requisition",
  wrappedControllers.getRequisitionHandler,
);
requisitionRouter.put(
  "/update-requisition",
  [permissions.protect],
  wrappedControllers.updateRequisitionHandler,
);
requisitionRouter.delete(
  "/delete-requisition",
  wrappedControllers.deleteRequisitionHandler,
);
requisitionRouter.get(
  "/staff-requisition",
  [permissions.protect, permissions.can_manage_requisitions],
  wrappedControllers.staffRequestHandler,
);
