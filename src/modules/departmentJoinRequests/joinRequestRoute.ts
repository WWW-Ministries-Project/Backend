import Router from "express";
import {
  listOpenDepartments,
  createJoinRequest,
  listJoinRequests,
  approveJoinRequest,
  declineJoinRequest,
  bulkJoinRequestAction,
} from "./joinRequestController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();
const protect = permissions.protect;

export const joinRequestRouter = Router();

// Member-facing: any authenticated user may view open departments and submit a request.
joinRequestRouter.get("/open-departments", [protect], listOpenDepartments);
joinRequestRouter.post("/create", [protect], createJoinRequest);

// Approver-facing: authorization is enforced per-request inside the controller
// (Membership_Management manager OR head of the target department).
joinRequestRouter.get("/list", [protect], listJoinRequests);
joinRequestRouter.patch("/approve", [protect], approveJoinRequest);
joinRequestRouter.patch("/decline", [protect], declineJoinRequest);
joinRequestRouter.post("/bulk", [protect], bulkJoinRequestAction);

export default joinRequestRouter;
