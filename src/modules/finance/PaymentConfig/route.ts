import { Router } from "express";
import { PaymentConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const paymentConfigRouter = Router();
const controller = new PaymentConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

paymentConfigRouter.post(
  "/create-payment-config",
  [protect, permissions.can_manage_settings],
  controller.create,
);
paymentConfigRouter.get(
  "/get-payment-configs",
  [protect, permissions.can_view_settings],
  controller.findAll,
);
paymentConfigRouter.put(
  "/update-payment-config",
  [protect, permissions.can_manage_settings],
  controller.update,
);
paymentConfigRouter.delete(
  "/delete-payment-config",
  [protect, permissions.can_delete_settings],
  controller.delete,
);

export default paymentConfigRouter;
