import Router from "express";
import {
  createBranch,
  deleteBranch,
  getBranchDeleteImpact,
  listBranches,
  updateBranch,
} from "./branchController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();

export const branchRouter = Router();

// Listing stays open to every signed-in user (pickers, member sign-up flows).
// Changing branches is a Settings action, limited to the caller's branches.
branchRouter.get("/list-branches", permissions.protect, listBranches);
branchRouter.post(
  "/create-branch",
  [permissions.protect, permissions.can_manage_settings],
  createBranch,
);
branchRouter.put(
  "/update-branch",
  [permissions.protect, permissions.can_manage_settings],
  updateBranch,
);
branchRouter.get(
  "/delete-impact",
  [permissions.protect, permissions.can_view_settings],
  getBranchDeleteImpact,
);
branchRouter.delete(
  "/delete-branch",
  [permissions.protect, permissions.can_delete_settings],
  deleteBranch,
);
