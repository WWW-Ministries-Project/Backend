import Router from "express";
import * as dotenv from "dotenv";
import {
  createPosition,
  updatePosition,
  deletePosition,
  listPositions,
  getPosition,
} from "../positions/positionController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;

dotenv.config();
export const positionRouter = Router();

positionRouter.post(
  "/create-position",
  [protect, permissions.can_create_positions],
  createPosition
);

positionRouter.put(
  "/update-position",
  [protect, permissions.can_edit_positions],
  updatePosition
);

positionRouter.delete(
  "/delete-position",
  [protect, permissions.can_delete_positions],
  deletePosition
);

positionRouter.get(
  "/list-positions",
  [protect, permissions.can_view_positions],
  listPositions
);

positionRouter.get(
  "/get-position",
  [protect, permissions.can_view_positions],
  getPosition
);
