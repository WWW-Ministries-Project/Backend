import Router from "express";
import * as dotenv from "dotenv";
import {} from "../../utils/";
import {
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
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
  createRequisitionHandler,
  listRequisitionHandler,
  getRequisitionHandler,
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
  "/create-requisition",
  wrappedControllers.createRequisitionHandler,
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
