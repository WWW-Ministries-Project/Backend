import { Router } from "express";
import { AtttendanceController } from "./attendanceController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;

const attendanceRouter = Router();
const attendanceController = new AtttendanceController();


attendanceRouter.get("/attendance",attendanceController.getAttendance);

export default attendanceRouter;