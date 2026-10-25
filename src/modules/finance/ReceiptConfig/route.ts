import { Router } from "express";
import { ReceiptConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { requireFinanceConfigAccess } from "../financeAccess";

const receiptConfigRouter = Router();
const controller = new ReceiptConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

receiptConfigRouter.post(
  "/create-receipt-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.create,
);
receiptConfigRouter.get(
  "/get-receipt-configs",
  [protect, permissions.withAccess, requireFinanceConfigAccess("view")],
  controller.findAll,
);
receiptConfigRouter.put(
  "/update-receipt-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.update,
);
receiptConfigRouter.delete(
  "/delete-receipt-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("admin")],
  controller.delete,
);

export default receiptConfigRouter;
