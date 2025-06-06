import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { DeviceController } from "./deviceController";


const permissions = new Permissions();
const protect = permissions.protect;

const deviceRouter = Router();
const deviceController = new DeviceController();


//life center roles
deviceRouter.post("/create-devices", deviceController.createDevices);
deviceRouter.get("/get-devices", deviceController.getAllDevices);
deviceRouter.get("/get-device", deviceController.getDevicesById);
deviceRouter.put("/update-device", deviceController.updateLifeCenter);
deviceRouter.delete("/delete-device", deviceController.deleteDevices);

export default deviceRouter;