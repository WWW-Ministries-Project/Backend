import Router from "express";
import * as dotenv from "dotenv";
// import { can_view_department,can_manage_department } from "../middleWare/authorization";
import { createAccessLevel, listAllAccessLevel } from "../controllers/accessLevelController";
import { can_manage_access, can_view_access, protect } from "../middleWare/authorization";

dotenv.config();
export const accessRouter = Router();

accessRouter.post("/create-access-level", [can_manage_access, protect], createAccessLevel);
accessRouter.get("/list-access-levels", [can_view_access, protect], listAllAccessLevel);

