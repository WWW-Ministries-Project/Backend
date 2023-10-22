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

positionRouter.post("/update-position", updatePosition);

positionRouter.post("/delete-position", deletePosition);

positionRouter.post("/list-positions", listPositions);

positionRouter.post("/get-positions", getPosition);
