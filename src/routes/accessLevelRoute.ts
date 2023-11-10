import Router from "express";
import * as dotenv from "dotenv";
import { createAccessLevel, listAllAccessLevel, updateAccessLevel, assignAccessLevelToUser } from "../controllers/accessLevelController";
import { can_manage_access, can_view_access, protect } from "../middleWare/authorization";

dotenv.config();
export const accessRouter = Router();

accessRouter.post("/create-access-level", [can_manage_access, protect], createAccessLevel);
accessRouter.put("/update-access-level", [can_manage_access, protect], updateAccessLevel);
accessRouter.put("/assign_access_to_user", [can_manage_access, protect], assignAccessLevelToUser);
accessRouter.get("/list-access-levels", [can_view_access, protect], listAllAccessLevel);

