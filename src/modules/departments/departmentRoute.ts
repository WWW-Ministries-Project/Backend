import Router from "express";
import * as dotenv from "dotenv";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  getDepartment,
} from "./departmentController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;

dotenv.config();
export const departmentRouter = Router();

departmentRouter.post(
  "/create-department",
  [permissions.protect, permissions.can_manage_department],
  createDepartment,
);

departmentRouter.put(
  "/update-department",
  [protect, permissions.can_manage_department],
  updateDepartment,
);

departmentRouter.delete(
  "/delete-department",
  [protect, permissions.can_delete_department],
  deleteDepartment,
);

departmentRouter.get(
  "/list-departments",
  [protect, permissions.can_view_department],
  listDepartments,
);

departmentRouter.get(
  "/get-department",
  [protect, permissions.can_view_department],
  getDepartment,
);
