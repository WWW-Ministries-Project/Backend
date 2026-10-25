import { Router } from "express";
import { TitheBreakdownConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { requireFinanceConfigAccess } from "../financeAccess";

const titheBreakdownConfigRouter = Router();
const controller = new TitheBreakdownConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

titheBreakdownConfigRouter.post(
  "/create-tithe-breakdown-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.create,
);
titheBreakdownConfigRouter.get(
  "/get-tithe-breakdown-configs",
  [protect, permissions.withAccess, requireFinanceConfigAccess("view")],
  controller.findAll,
);
titheBreakdownConfigRouter.put(
  "/update-tithe-breakdown-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.update,
);
titheBreakdownConfigRouter.delete(
  "/delete-tithe-breakdown-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("admin")],
  controller.delete,
);

export default titheBreakdownConfigRouter;
