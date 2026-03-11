import { Router } from "express";
import roleEligibilityController from "./roleEligibilityController";
import { Permissions } from "../../middleWare/authorization";

const settingsRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

settingsRouter.get(
  "/get-role-eligibility-config",
  [protect, permissions.can_view_settings],
  roleEligibilityController.getConfig,
);

settingsRouter.post(
  "/upsert-role-eligibility-config",
  [protect, permissions.can_manage_settings],
  roleEligibilityController.upsertConfig,
);

export default settingsRouter;
