import { Router } from "express";
import { AnnualThemeController } from "./controller";
import { Permissions } from "../../middleWare/authorization";

const themeRouter = Router();
const controller = new AnnualThemeController();
const permissions = new Permissions();
const protect = permissions.protect;

themeRouter.post(
  "/create-theme",
  [protect, permissions.can_manage_theme],
  controller.create,
);
themeRouter.get("/get-themes", [protect], controller.findAll);
themeRouter.get("/get-active-theme", [protect], controller.findActive);
themeRouter.get("/get-theme", [protect], controller.findById);
themeRouter.put(
  "/update-theme",
  [protect, permissions.can_manage_theme],
  controller.update,
);
themeRouter.delete(
  "/delete-theme",
  [protect, permissions.can_delete_theme],
  controller.delete,
);

export default themeRouter;
