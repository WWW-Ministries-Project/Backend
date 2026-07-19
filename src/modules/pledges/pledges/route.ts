import { Router } from "express";
import { Permissions } from "../../../middleWare/authorization";
import {
  createPledge,
  getPledges,
  getPledge,
  updatePledge,
  deletePledge,
} from "./controller";

const permissions = new Permissions();
const protect = permissions.protect;
export const pledgesRouter = Router();

pledgesRouter.get("/get-pledges", [protect, permissions.can_view_pledges], getPledges);
pledgesRouter.get("/get-pledge", [protect, permissions.can_view_pledges], getPledge);
pledgesRouter.post("/create-pledge", [protect, permissions.can_manage_pledges], createPledge);
pledgesRouter.put("/update-pledge", [protect, permissions.can_manage_pledges], updatePledge);
pledgesRouter.delete("/delete-pledge", [protect, permissions.can_delete_pledges], deletePledge);
