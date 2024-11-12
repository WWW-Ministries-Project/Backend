import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { eventManagement } from "../events/eventContoller";
const eventContoller = new eventManagement();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const eventRouter = Router();

eventRouter.get(
  "/get-event",
  [protect, permissions.can_view_events],
  eventContoller.getEvent
);

eventRouter.get(
  "/list-events",
  [protect, permissions.can_view_events],
  eventContoller.listEvents
);
eventRouter.get("/events-stats", [protect], eventContoller.eventStats);

eventRouter.get(
  "/upcoming-events",
  [protect],
  eventContoller.listUpcomingEvents
);

eventRouter.post(
  "/create-event",
  [protect, permissions.can_edit_events],
  eventContoller.createEvent
);

eventRouter.put(
  "/update-event",
  [protect, permissions.can_edit_events],
  eventContoller.updateEvent
);

eventRouter.delete(
  "/delete-event",
  [protect, permissions.can_edit_events],
  eventContoller.deleteEvent
);

eventRouter.post("/sign-attendance", eventContoller.eventAttendance);
eventRouter.get("/search-user", eventContoller.searchUser1);
