import Router from "express";
import * as dotenv from "dotenv";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
} from "../controllers/departmentController";
import { can_view_department,can_manage_department, protect } from "../middleWare/authorization";

dotenv.config();
export const departmentRouter = Router();

departmentRouter.post("/create-department", [protect, can_manage_department], createDepartment);

departmentRouter.put("/update-department", [protect, can_manage_department], updateDepartment);

departmentRouter.delete("/delete-department", [protect, can_manage_department], deleteDepartment);

departmentRouter.get("/list-departments", [protect, can_view_department], listDepartments);

departmentRouter.get("/get-department", [protect, can_view_department], getDepartment);
