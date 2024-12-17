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
  [permissions.can_manage_access, permissions.protect],
  createAccessLevel
);
accessRouter.put(
  "/update-access-level",
  [permissions.can_manage_access, permissions.protect],
  updateAccessLevel
);
accessRouter.put(
  "/assign_access_to_user",
  [permissions.can_manage_access, permissions.protect],
  assignAccessLevelToUser
);
accessRouter.delete(
  "/delete-access-level",
  [permissions.can_manage_access, permissions.protect],
  deleteAccessLevel
);
accessRouter.get(
  "/list-access-levels",
  [permissions.can_view_access, permissions.protect],
  listAllAccessLevel
);
accessRouter.get("/get-access-level", [
  permissions.can_view_access,
  permissions.protect,
  getAccessLevel,
]);
