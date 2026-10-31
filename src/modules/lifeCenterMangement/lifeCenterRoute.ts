import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { LifeCenterRoleController } from "./lifeCenterRoleController";
import { LifeCenterController } from "./lifeCenterController";
import { LifeCenterMeetingController } from "./lifeCenterMeetingController";
import { lifeCenterGuard, lifeCenterRolesGuard } from "./lifeCenterAccess";

const permissions = new Permissions();
const protect = permissions.protect;

const lifeCenterRouter = Router();
const roleController = new LifeCenterRoleController();
const lifeCenterController = new LifeCenterController();
const lifeCenterMeetingController = new LifeCenterMeetingController();

// Actions and scopes (src/permissions/catalog.ts, "Life Center") are applied
// by lifeCenterGuard after withAccess: the role's scope (whole branch or the
// centers they lead), its actions, and leader tools for a center's leadership.
const access = permissions.withAccess;
const view = [protect, access, lifeCenterGuard()];
const can = (action: string, options: { leaderTool?: boolean; wholeBranchOnly?: boolean } = {}) => [
  protect,
  access,
  lifeCenterGuard({ action, ...options }),
];

//life center roles
lifeCenterRouter.post(
  "/create-role",
  [protect, access, lifeCenterRolesGuard],
  roleController.createLifeCenterRole,
);
lifeCenterRouter.get(
  "/get-roles",
  [protect, permissions.can_view_life_center],
  roleController.getAllLifeCenterRoles,
);
lifeCenterRouter.get(
  "/get-role",
  [protect, permissions.can_view_life_center],
  roleController.getLifeCenterRoleById,
);
lifeCenterRouter.put(
  "/update-role",
  [protect, access, lifeCenterRolesGuard],
  roleController.updateLifeCenterRole,
);
lifeCenterRouter.delete(
  "/delete-role",
  [protect, permissions.requireAction("Life Center", "manage_roles", "Not authorized to delete life center roles")],
  roleController.deleteLifeCenterRole,
);

//life center
lifeCenterRouter.post(
  "/create-lifecenter",
  [protect, permissions.can_manage_life_center, lifeCenterGuard()],
  lifeCenterController.createLifeCenter,
);
lifeCenterRouter.get(
  "/get-lifecenter",
  view,
  lifeCenterController.getLifeCenterById,
);
lifeCenterRouter.get(
  "/overview",
  view,
  lifeCenterController.getOverview,
);
lifeCenterRouter.post(
  "/remind-leader",
  can("remind_leader"),
  lifeCenterController.remindLeader,
);
lifeCenterRouter.get(
  "/get-lifecenters",
  view,
  lifeCenterController.getAllLifeCenters,
);
lifeCenterRouter.put(
  "/update-lifecenter",
  [protect, permissions.can_manage_life_center, lifeCenterGuard()],
  lifeCenterController.updateLifeCenter,
);
lifeCenterRouter.delete(
  "/delete-lifecenter",
  can("delete"),
  lifeCenterController.deleteLifeCenter,
);

//adding members to life center
lifeCenterRouter.post(
  "/add-lifecenter-member",
  can("assign_members"),
  lifeCenterController.addMemberToLifeCenter,
);

lifeCenterRouter.put(
  "/update-member-role",
  can("assign_members"),
  lifeCenterController.updateMemberRole,
);

lifeCenterRouter.delete(
  "/remove-lifecenter-member",
  can("delete"),
  lifeCenterController.removeMemberFromLifeCenter,
);

//getlifecentermembers
lifeCenterRouter.get(
  "/get-lifecenter-members",
  view,
  lifeCenterController.getAllLifeCenterMembers,
);

//addsoul
lifeCenterRouter.post(
  "/soulwon",
  can("record_souls", { leaderTool: true }),
  lifeCenterController.createSoulWon,
);
//removesoul
lifeCenterRouter.delete(
  "/soulwon",
  can("delete"),
  lifeCenterController.removeSoulWon,
);
//updatesoul
lifeCenterRouter.put(
  "/soulwon",
  can("record_souls", { leaderTool: true }),
  lifeCenterController.updateSoulWon,
);
//getsouls
lifeCenterRouter.get(
  "/soulswon",
  view,
  lifeCenterController.getSouls,
);
//getsoul
lifeCenterRouter.get(
  "/soulwon",
  view,
  lifeCenterController.getSoul,
);

//lifecenter stats
lifeCenterRouter.get(
  "/stats",
  view,
  lifeCenterController.getStats,
);

//mylifecenter
lifeCenterRouter.get("/my-lifecenter", [protect], lifeCenterController.mylifecenter);

//life center meetings
lifeCenterRouter.post(
  "/meeting",
  can("record_meeting", { leaderTool: true }),
  lifeCenterMeetingController.createMeeting,
);
lifeCenterRouter.put(
  "/meeting",
  can("record_meeting", { leaderTool: true }),
  lifeCenterMeetingController.updateMeeting,
);
lifeCenterRouter.delete(
  "/meeting",
  can("delete"),
  lifeCenterMeetingController.deleteMeeting,
);
lifeCenterRouter.get(
  "/meeting",
  view,
  lifeCenterMeetingController.getMeeting,
);
lifeCenterRouter.get(
  "/meetings",
  view,
  lifeCenterMeetingController.getMeetings,
);
lifeCenterRouter.get(
  "/meetings/export",
  can("export", { leaderTool: true }),
  lifeCenterMeetingController.exportMeetings,
);
lifeCenterRouter.get(
  "/soulswon-eligible-first-timers",
  view,
  lifeCenterMeetingController.getEligibleFirstTimers,
);

export default lifeCenterRouter;
