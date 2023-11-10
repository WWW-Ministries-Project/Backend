import Router from "express";
import * as dotenv from "dotenv";
import {
  createPosition,
  updatePosition,
  deletePosition,
  listPositions,
  getPosition,
} from "../controllers/positionController";
import { can_view_positions, can_manage_department, protect } from "../middleWare/authorization";

dotenv.config();
export const positionRouter = Router();

positionRouter.post("/create-position", [protect, can_manage_department], createPosition);

positionRouter.put("/update-position", [protect ,can_manage_department], updatePosition);

positionRouter.delete("/delete-position", [protect, can_manage_department],  deletePosition);

positionRouter.get("/list-positions", [protect, can_view_positions], listPositions);

positionRouter.get("/get-position", [protect, can_view_positions], getPosition);
