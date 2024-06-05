import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../middleWare/authorization";
import { eventManagement } from "../controllers/eventContoller";
const eventContoller = new eventManagement();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const eventRouter = Router();

eventRouter.get("/get-event", eventContoller.getEvent);

eventRouter.get("/list-events", [protect], eventContoller.listEvents);

eventRouter.post("/create-event", eventContoller.createEvent);

eventRouter.put("/update-event", eventContoller.updateEvent);

eventRouter.delete("/delete-event", eventContoller.deleteEvent);
