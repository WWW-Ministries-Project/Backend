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
  eventContoller.getEvent,
);

eventRouter.get("/list-events", eventContoller.listEvents);
eventRouter.get(
  "/list-events-light",
  [protect, permissions.can_view_events],
  eventContoller.listEventsLight,
);
eventRouter.get("/events-stats", [protect], eventContoller.eventStats);

eventRouter.get(
  "/upcoming-events",
  [protect],
  eventContoller.listUpcomingEvents,
);

eventRouter.post(
  "/create-event",
  [protect, permissions.can_manage_events],
  eventContoller.createEvent,
);

eventRouter.put(
  "/update-event",
  [protect, permissions.can_manage_events],
  eventContoller.updateEvent,
);

eventRouter.delete(
  "/delete-event",
  [protect, permissions.can_delete_events],
  eventContoller.deleteEvent,
);

eventRouter.post("/sign-attendance", eventContoller.eventAttendance);
eventRouter.get("/search-user", eventContoller.searchUser1);

eventRouter.post("/create-event-type", eventContoller.createEventType);
eventRouter.put("/update-event-type", eventContoller.updateEventType);
eventRouter.get("/get-event-type", eventContoller.getEventType);
eventRouter.get("/get-event-types", eventContoller.getEventTypes);
eventRouter.delete("/delete-event-type", eventContoller.deleteEventType);

eventRouter.post("/register", eventContoller.register);
eventRouter.get(
  "/get-registered-event-members",
  eventContoller.allRegisteredMembers,
);
eventRouter.get(
  "/all-registered-event-member",
  eventContoller.registeredMember,
);

/**
 * Create attendance summary
 */
eventRouter.post(
  "/attendance-summary",
  eventContoller.createAttendanceSummary
);

/**
 * Get all attendance summaries
 * Optional query params: ?eventId=&date=
 */
eventRouter.get(
  "/attendance-summary",
  eventContoller.getAttendances
);

/**
 * Get attendance summary by ID
 * Uses query param ?id=
 */
eventRouter.get(
  "/attendance-summary/by-id",
  eventContoller.getAttendanceById
);

/**
 * Update attendance summary by ID
 * Uses URL param :id
 */
eventRouter.put(
  "/attendance-summary/:id",
  eventContoller.updateAttendance
);

/**
 * Delete attendance summary by ID
 * Uses URL param :id
 */
eventRouter.delete(
  "/attendance-summary/:id",
  eventContoller.deleteAttendance
);

