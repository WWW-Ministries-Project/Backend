import Router from "express";
import * as dotenv from "dotenv";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
} from "../controllers/departmentController";
dotenv.config();
export const departmentRouter = Router();

departmentRouter.post("/create-department", createDepartment);

departmentRouter.post("/update-department", updateDepartment);

departmentRouter.post("/delete-department", deleteDepartment);

departmentRouter.post("/list-departments", listDepartments);

departmentRouter.post("/get-departments", getDepartment);
