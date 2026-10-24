import Router from "express";
import * as dotenv from "dotenv";
import {
  createAccessLevel,
  listAllAccessLevel,
  updateAccessLevel,
  updateAccessLevelWorkspaces,
  assignAccessLevelToUser,
  deleteAccessLevel,
  getAccessLevel,
  listAssignableUsers,
  bulkAssignAccessLevel,
  getUserBranchAccess,
  setUserBranchAccess,
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
  "/access-level-workspaces",
  [permissions.protect, permissions.can_manage_access],
  updateAccessLevelWorkspaces,
);
accessRouter.put(
  "/assign_access_to_user",
  [permissions.protect, permissions.can_manage_access],
  assignAccessLevelToUser,
);
accessRouter.get(
  "/assignable-users",
  [permissions.protect, permissions.can_manage_access],
  listAssignableUsers,
);
accessRouter.put(
  "/bulk-assign-access-level",
  [permissions.protect, permissions.can_manage_access],
  bulkAssignAccessLevel,
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
accessRouter.get(
  "/user-branch-access",
  [permissions.protect, permissions.can_view_access],
  getUserBranchAccess,
);
accessRouter.put(
  "/user-branch-access",
  [permissions.protect, permissions.can_manage_access],
  setUserBranchAccess,
);
