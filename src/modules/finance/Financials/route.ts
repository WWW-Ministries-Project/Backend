import { Router } from "express";
import { FinancialsController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const financialsRouter = Router();
const controller = new FinancialsController();
const permissions = new Permissions();
const protect = permissions.protect;

financialsRouter.post(
  "/create-financial",
  [protect, permissions.can_manage_financials],
  controller.create,
);
financialsRouter.get(
  "/get-financials",
  [protect, permissions.can_view_financials],
  controller.findAll,
);
financialsRouter.get(
  "/get-financial",
  [protect, permissions.can_view_financials],
  controller.findOne,
);
financialsRouter.put(
  "/update-financial",
  [protect, permissions.can_manage_financials],
  controller.update,
);
financialsRouter.delete(
  "/delete-financial",
  [protect, permissions.can_delete_financials],
  controller.delete,
);

export default financialsRouter;
