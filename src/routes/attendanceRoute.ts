import Router from "express";
import * as dotenv from "dotenv";
import {
  markAttendance,
  getAllattendance,
  getDateattendance,
} from "../controllers/attendanceController";
dotenv.config();
export const attendanceRouter = Router();

attendanceRouter.post("/mark-attendance", markAttendance);

attendanceRouter.get("/all", getAllattendance);

attendanceRouter.get("/byDate", getDateattendance);
