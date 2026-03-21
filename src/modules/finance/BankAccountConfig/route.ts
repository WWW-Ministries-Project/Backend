import { Router } from "express";
import { BankAccountConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const bankAccountConfigRouter = Router();
const controller = new BankAccountConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

bankAccountConfigRouter.post(
  "/create-bank-account-config",
  [protect, permissions.can_manage_settings],
  controller.create,
);
bankAccountConfigRouter.get(
  "/get-bank-account-configs",
  [protect, permissions.can_view_settings],
  controller.findAll,
);
bankAccountConfigRouter.put(
  "/update-bank-account-config",
  [protect, permissions.can_manage_settings],
  controller.update,
);
bankAccountConfigRouter.delete(
  "/delete-bank-account-config",
  [protect, permissions.can_delete_settings],
  controller.delete,
);

export default bankAccountConfigRouter;
