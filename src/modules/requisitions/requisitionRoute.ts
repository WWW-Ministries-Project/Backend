import Router from "express";
import * as dotenv from "dotenv";
import {
  createRequisitionHandler,
  listRequisitionHandler,
  hodApproveRequisitionHandler,
  psApproveRequisitionHandler,
  getRequisitionHandler,
  updateRequisitionHandler,
  deleteRequisitionHandler,
} from "./requisitionsController";

import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
dotenv.config();

export const requisitionRouter = Router();

requisitionRouter.post(
  "/create-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  createRequisitionHandler
);

requisitionRouter.get(
  "/list-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  listRequisitionHandler
);

requisitionRouter.post(
  "/approve-requisition-hod",
  // [permissions.protect, permissions.can_create_requisitions],
  hodApproveRequisitionHandler
);

requisitionRouter.post(
  "/approve-requisition-pastor",
  // [permissions.protect, permissions.can_create_requisitions],
  psApproveRequisitionHandler
);

requisitionRouter.get(
  "/get-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  getRequisitionHandler
);
requisitionRouter.put(
  "/update-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  updateRequisitionHandler
);
requisitionRouter.delete(
  "/delete-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  deleteRequisitionHandler
);
