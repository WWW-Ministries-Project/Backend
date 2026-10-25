import { Router } from "express";
import { Permissions } from "../../../middleWare/authorization";
import {
  createPledge,
  getPledges,
  getPledge,
  updatePledge,
  deletePledge,
  remindPledgers,
} from "./controller";

const permissions = new Permissions();
const protect = permissions.protect;
export const pledgesRouter = Router();

pledgesRouter.get("/get-pledges", [protect, permissions.can_view_pledges], getPledges);
pledgesRouter.get("/get-pledge", [protect, permissions.can_view_pledges], getPledge);
pledgesRouter.post(
  "/create-pledge",
  [protect, permissions.requireAction("Pledges", "create", "Not authorized to create pledges")],
  createPledge,
);
pledgesRouter.put(
  "/update-pledge",
  [protect, permissions.requireAction("Pledges", "edit", "Not authorized to edit pledges")],
  updatePledge,
);
pledgesRouter.delete(
  "/delete-pledge",
  [protect, permissions.requireAction("Pledges", "delete", "Not authorized to delete pledges")],
  deletePledge,
);
pledgesRouter.post(
  "/remind-pledgers",
  [protect, permissions.requireAction("Pledges", "send_reminders", "Not authorized to send pledge reminders")],
  remindPledgers,
);
