import { Router } from "express";
import multer from "multer";
import { Permissions } from "../../../middleWare/authorization";
import {
  createRedemption,
  deleteRedemption,
  addPledgers,
  deletePledger,
} from "./controller";

const upload = multer({ dest: "uploads/" });
const permissions = new Permissions();
const protect = permissions.protect;
export const redemptionsRouter = Router();

redemptionsRouter.post(
  "/create-redemption",
  [protect, upload.single("file"), permissions.can_manage_pledges],
  createRedemption,
);
redemptionsRouter.delete(
  "/delete-redemption",
  [protect, permissions.can_manage_pledges],
  deleteRedemption,
);
redemptionsRouter.post(
  "/add-pledgers",
  [protect, permissions.can_manage_pledges],
  addPledgers,
);
redemptionsRouter.delete(
  "/delete-pledger",
  [protect, permissions.can_manage_pledges],
  deletePledger,
);
