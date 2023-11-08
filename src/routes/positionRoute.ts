import Router from "express";
import * as dotenv from "dotenv";
import {
  createPosition,
  updatePosition,
  deletePosition,
  listPositions,
  getPosition,
} from "../controllers/positionController";
dotenv.config();
export const positionRouter = Router();

positionRouter.post("/create-position", createPosition);

positionRouter.put("/update-position", updatePosition);

positionRouter.post("/delete-position", deletePosition);

positionRouter.get("/list-positions", listPositions);

positionRouter.get("/get-position", getPosition);
