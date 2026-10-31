import Router from "express";
import {
  createBranch,
  deleteBranch,
  getBranchDeleteImpact,
  listBranches,
  setDefaultBranch,
  updateBranch,
} from "./branchController";
import { Permissions } from "../../middleWare/authorization";
import { OrgWideRule, requireOrgWide } from "../settings/orgWideAccess";

const permissions = new Permissions();

export const branchRouter = Router();

// Listing stays open to every signed-in user (pickers, member sign-up flows).
// Changing branches needs Settings.manage_branches (on purpose) in every branch
// the caller holds a role in. Roles saved before actions keep the Settings
// rule they had: manage (delete: Full) in the selected branch.
const manageBranches = (legacyLevel: "manage" | "admin"): OrgWideRule => ({
  action: ["Settings", "manage_branches"],
  legacy: { domain: "Settings", level: legacyLevel, everyBranch: false },
});
const BRANCH_FORBIDDEN = "Not authorized to manage branches";
branchRouter.get("/list-branches", permissions.protect, listBranches);
branchRouter.post(
  "/create-branch",
  requireOrgWide(manageBranches("manage"), BRANCH_FORBIDDEN),
  createBranch,
);
branchRouter.put(
  "/update-branch",
  requireOrgWide(manageBranches("manage"), BRANCH_FORBIDDEN),
  updateBranch,
);
branchRouter.put(
  "/set-default-branch",
  requireOrgWide(manageBranches("manage"), BRANCH_FORBIDDEN),
  setDefaultBranch,
);
branchRouter.get(
  "/delete-impact",
  [permissions.protect, permissions.can_view_settings],
  getBranchDeleteImpact,
);
branchRouter.delete(
  "/delete-branch",
  requireOrgWide(manageBranches("admin"), BRANCH_FORBIDDEN),
  deleteBranch,
);
