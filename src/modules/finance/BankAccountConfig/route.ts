import { Router } from "express";
import { BankAccountConfigController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { requireFinanceConfigAccess } from "../financeAccess";

const bankAccountConfigRouter = Router();
const controller = new BankAccountConfigController();
const permissions = new Permissions();
const protect = permissions.protect;

bankAccountConfigRouter.post(
  "/create-bank-account-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.create,
);
bankAccountConfigRouter.get(
  "/get-bank-account-configs",
  [protect, permissions.withAccess, requireFinanceConfigAccess("view")],
  controller.findAll,
);
bankAccountConfigRouter.put(
  "/update-bank-account-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("manage")],
  controller.update,
);
bankAccountConfigRouter.delete(
  "/delete-bank-account-config",
  [protect, permissions.withAccess, requireFinanceConfigAccess("admin")],
  controller.delete,
);

export default bankAccountConfigRouter;
