import { Router } from "express";
import { AnnualThemeController } from "./controller";
import { Permissions } from "../../middleWare/authorization";

const themeRouter = Router();
const controller = new AnnualThemeController();
const permissions = new Permissions();
const protect = permissions.protect;
const canViewTheme = permissions.checkPermission(
  "Theme",
  "view",
  "Not authorized to view themes",
);

themeRouter.post(
  "/create-theme",
  [protect, permissions.requireAction("Theme", "edit", "Not authorized to edit the theme")],
  controller.create,
);
// The admin listing needs Theme view; the active theme stays open to every
// signed-in member (the web dashboard and the mobile home screen read it).
themeRouter.get("/get-themes", [protect, canViewTheme], controller.findAll);
themeRouter.get("/get-active-theme", [protect], controller.findActive);
themeRouter.get("/get-theme", [protect, canViewTheme], controller.findById);
themeRouter.put(
  "/update-theme",
  [protect, permissions.requireAction("Theme", "edit", "Not authorized to edit the theme")],
  controller.update,
);
themeRouter.delete(
  "/delete-theme",
  [protect, permissions.can_delete_theme],
  controller.delete,
);

export default themeRouter;
