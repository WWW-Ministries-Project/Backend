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
lifeCenterRouter.post("/create-role", roleController.createLifeCenterRole);
lifeCenterRouter.get("/get-roles", roleController.getAllLifeCenterRoles);
lifeCenterRouter.get("/get-role", roleController.getLifeCenterRoleById);
lifeCenterRouter.put("/update-role", roleController.updateLifeCenterRole);
lifeCenterRouter.delete("/delete-role", roleController.deleteLifeCenterRole);

//life center
lifeCenterRouter.post(
  "/create-lifecenter",
  lifeCenterController.createLifeCenter,
);
lifeCenterRouter.get("/get-lifecenter", lifeCenterController.getLifeCenterById);
lifeCenterRouter.get(
  "/get-lifecenters",
  lifeCenterController.getAllLifeCenters,
);
lifeCenterRouter.put(
  "/update-lifecenter",
  lifeCenterController.updateLifeCenter,
);
lifeCenterRouter.delete(
  "/delete-lifecenter",
  lifeCenterController.deleteLifeCenter,
);

//adding members to life center
lifeCenterRouter.post(
  "/add-lifecenter-member",
  lifeCenterController.addMemberToLifeCenter,
);

lifeCenterRouter.put(
  "/update-member-role",
  lifeCenterController.updateMemberRole,
);

lifeCenterRouter.delete(
  "/remove-lifecenter-member",
  lifeCenterController.removeMemberFromLifeCenter,
);

//getlifecentermembers
lifeCenterRouter.get(
  "/get-lifecenter-members",
  lifeCenterController.getAllLifeCenterMembers,
);

//addsoul
lifeCenterRouter.post("/soulwon", lifeCenterController.createSoulWon);
//removesoul
lifeCenterRouter.delete("/soulwon", lifeCenterController.removeSoulWon);
//updatesoul
lifeCenterRouter.put("/soulwon", lifeCenterController.updateSoulWon);
//getsouls
lifeCenterRouter.get("/soulswon", lifeCenterController.getSouls);
//getsoul
lifeCenterRouter.get("/soulwon", lifeCenterController.getSoul);

export default lifeCenterRouter;
