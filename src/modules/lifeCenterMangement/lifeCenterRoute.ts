import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { LifeCenterRoleController } from "./lifeCenterRoleController";
import { LifeCenterController } from "./lifeCenterController";

const permissions = new Permissions();
const protect = permissions.protect;

const lifeCenterRouter = Router();
const roleController = new LifeCenterRoleController();
const lifeCenterController = new LifeCenterController();

//life center roles
lifeCenterRouter.post(
  "/create-role",
  [protect, permissions.can_manage_life_center],
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
  [protect, permissions.can_manage_life_center],
  roleController.updateLifeCenterRole,
);
lifeCenterRouter.delete(
  "/delete-role",
  [protect, permissions.can_delete_life_center],
  roleController.deleteLifeCenterRole,
);

//life center
lifeCenterRouter.post(
  "/create-lifecenter",
  [protect, permissions.can_manage_life_center],
  lifeCenterController.createLifeCenter,
);
lifeCenterRouter.get(
  "/get-lifecenter",
  [protect, permissions.can_view_life_center_scoped],
  lifeCenterController.getLifeCenterById,
);
lifeCenterRouter.get(
  "/get-lifecenters",
  [protect, permissions.can_view_life_center_scoped],
  lifeCenterController.getAllLifeCenters,
);
lifeCenterRouter.put(
  "/update-lifecenter",
  [protect, permissions.can_manage_life_center],
  lifeCenterController.updateLifeCenter,
);
lifeCenterRouter.delete(
  "/delete-lifecenter",
  [protect, permissions.can_delete_life_center],
  lifeCenterController.deleteLifeCenter,
);

//adding members to life center
lifeCenterRouter.post(
  "/add-lifecenter-member",
  [protect, permissions.can_manage_life_center],
  lifeCenterController.addMemberToLifeCenter,
);

lifeCenterRouter.put(
  "/update-member-role",
  [protect, permissions.can_manage_life_center],
  lifeCenterController.updateMemberRole,
);

lifeCenterRouter.delete(
  "/remove-lifecenter-member",
  [protect, permissions.can_delete_life_center],
  lifeCenterController.removeMemberFromLifeCenter,
);

//getlifecentermembers
lifeCenterRouter.get(
  "/get-lifecenter-members",
  [protect, permissions.can_view_life_center_scoped],
  lifeCenterController.getAllLifeCenterMembers,
);

//addsoul
lifeCenterRouter.post(
  "/soulwon",
  [protect, permissions.can_manage_life_center_scoped],
  lifeCenterController.createSoulWon,
);
//removesoul
lifeCenterRouter.delete(
  "/soulwon",
  [protect, permissions.can_delete_life_center],
  lifeCenterController.removeSoulWon,
);
//updatesoul
lifeCenterRouter.put(
  "/soulwon",
  [protect, permissions.can_manage_life_center_scoped],
  lifeCenterController.updateSoulWon,
);
//getsouls
lifeCenterRouter.get(
  "/soulswon",
  [protect, permissions.can_view_life_center_scoped],
  lifeCenterController.getSouls,
);
//getsoul
lifeCenterRouter.get(
  "/soulwon",
  [protect, permissions.can_view_life_center_scoped],
  lifeCenterController.getSoul,
);

//lifecenter stats
lifeCenterRouter.get(
  "/stats",
  [protect, permissions.can_view_life_center],
  lifeCenterController.getStats,
);

//mylifecenter
lifeCenterRouter.get("/my-lifecenter", [protect], lifeCenterController.mylifecenter);

export default lifeCenterRouter;
