import Router from "express";
import {
  listOpenDepartments,
  listMyJoinRequests,
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
joinRequestRouter.get("/mine", [protect], listMyJoinRequests);

// Approver-facing: authorization is enforced per-request inside the controller
// from the live role (`req.access`): Membership management › Decide join
// requests within its scope, OR head of the target department.
const withAccess = permissions.withAccess;
joinRequestRouter.get("/list", [protect, withAccess], listJoinRequests);
joinRequestRouter.patch("/approve", [protect, withAccess], approveJoinRequest);
joinRequestRouter.patch("/decline", [protect, withAccess], declineJoinRequest);
joinRequestRouter.post("/bulk", [protect, withAccess], bulkJoinRequestAction);

export default joinRequestRouter;
