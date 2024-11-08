import Router from "express";
import * as dotenv from "dotenv";
import { createRequisitionHandler } from "../requisitions/requisitionsController";

import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
dotenv.config();

export const requisitionRouter = Router();

requisitionRouter.post(
  "/create-requisition",
  // [permissions.protect, permissions.can_create_requisitions],
  createRequisitionHandler
);
