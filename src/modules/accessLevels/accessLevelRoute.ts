import Router from "express";
import * as dotenv from "dotenv";
import {
  createAccessLevel,
  listAllAccessLevel,
  updateAccessLevel,
  assignAccessLevelToUser,
  deleteAccessLevel,
  getAccessLevel,
} from "../accessLevels/accessLevelController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
dotenv.config();
export const accessRouter = Router();

accessRouter.post(
  "/create-access-level",
  [permissions.protect, permissions.can_manage_access],
  createAccessLevel,
);
accessRouter.put(
  "/update-access-level",
  [permissions.protect, permissions.can_manage_access],
  updateAccessLevel,
);
accessRouter.put(
  "/assign_access_to_user",
  [permissions.protect, permissions.can_manage_access],
  assignAccessLevelToUser,
);
accessRouter.delete(
  "/delete-access-level",
  [permissions.protect, permissions.can_delete_access],
  deleteAccessLevel,
);
accessRouter.get(
  "/list-access-levels",
  [permissions.protect, permissions.can_view_access],
  listAllAccessLevel,
);
accessRouter.get(
  "/get-access-level",
  [permissions.protect, permissions.can_view_access],
  getAccessLevel,
);
