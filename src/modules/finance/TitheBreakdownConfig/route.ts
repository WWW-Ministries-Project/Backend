import { Router } from "express";
import { TitheBreakdownConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const titheBreakdownConfigRouter = Router();
const controller = new TitheBreakdownConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

titheBreakdownConfigRouter.post(
  "/create-tithe-breakdown-config",
  [protect, permissions.can_manage_settings],
  controller.create,
);
titheBreakdownConfigRouter.get(
  "/get-tithe-breakdown-configs",
  [protect, permissions.can_view_settings],
  controller.findAll,
);
titheBreakdownConfigRouter.put(
  "/update-tithe-breakdown-config",
  [protect, permissions.can_manage_settings],
  controller.update,
);
titheBreakdownConfigRouter.delete(
  "/delete-tithe-breakdown-config",
  [protect, permissions.can_delete_settings],
  controller.delete,
);

export default titheBreakdownConfigRouter;
