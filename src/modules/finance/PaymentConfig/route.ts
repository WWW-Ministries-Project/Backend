import { Router } from "express";
import { PaymentConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { requireFinanceConfigAccess } from "../financeAccess";

const paymentConfigRouter = Router();
const controller = new PaymentConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

paymentConfigRouter.post(
  "/create-payment-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.create,
);
paymentConfigRouter.get(
  "/get-payment-configs",
  [protect, permissions.withAccess, requireFinanceConfigAccess("view")],
  controller.findAll,
);
paymentConfigRouter.put(
  "/update-payment-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.update,
);
paymentConfigRouter.delete(
  "/delete-payment-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("admin")],
  controller.delete,
);

export default paymentConfigRouter;
