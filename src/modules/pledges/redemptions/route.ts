import { Router } from "express";
import { Permissions } from "../../../middleWare/authorization";
import {
  createRedemption,
  deleteRedemption,
  addPledgers,
  deletePledger,
} from "./controller";

const permissions = new Permissions();
const protect = permissions.protect;
export const redemptionsRouter = Router();

redemptionsRouter.post(
  "/create-redemption",
  [protect, permissions.requireAction("Pledges", "record_redemption", "Not authorized to record redemptions")],
  createRedemption,
);
redemptionsRouter.delete(
  "/delete-redemption",
  [protect, permissions.requireAction("Pledges", "reverse_redemption", "Not authorized to reverse redemptions")],
  deleteRedemption,
);
redemptionsRouter.post(
  "/add-pledgers",
  [protect, permissions.requireAction("Pledges", "edit", "Not authorized to edit pledges")],
  addPledgers,
);
redemptionsRouter.delete(
  "/delete-pledger",
  [protect, permissions.requireAction("Pledges", "edit", "Not authorized to edit pledges")],
  deletePledger,
);
