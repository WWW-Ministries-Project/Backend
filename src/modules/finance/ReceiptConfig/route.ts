import { Router } from "express";
import { ReceiptConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const receiptConfigRouter = Router();
const controller = new ReceiptConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

receiptConfigRouter.post(
  "/create-receipt-config",
  [protect, permissions.can_manage_settings],
  controller.create,
);
receiptConfigRouter.get(
  "/get-receipt-configs",
  [protect, permissions.can_view_settings],
  controller.findAll,
);
receiptConfigRouter.put(
  "/update-receipt-config",
  [protect, permissions.can_manage_settings],
  controller.update,
);
receiptConfigRouter.delete(
  "/delete-receipt-config",
  [protect, permissions.can_delete_settings],
  controller.delete,
);

export default receiptConfigRouter;
