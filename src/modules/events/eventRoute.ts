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
  [protect],
  eventContoller.getEvent,
);

eventRouter.get("/list-events", [protect], eventContoller.listEvents);
eventRouter.get(
  "/list-events-light",
  [protect],
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

eventRouter.post(
  "/create-event-type",
  [protect, permissions.can_manage_events],
  eventContoller.createEventType,
);
eventRouter.put(
  "/update-event-type",
  [protect, permissions.can_manage_events],
  eventContoller.updateEventType,
);
eventRouter.get("/get-event-type", [protect], eventContoller.getEventType);
eventRouter.get("/get-event-types", [protect], eventContoller.getEventTypes);
eventRouter.delete(
  "/delete-event-type",
  [protect, permissions.can_delete_events],
  eventContoller.deleteEventType,
);

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
  "/church-attendance",
  [protect, permissions.can_manage_church_attendance],
  eventContoller.createAttendanceSummary,
);

/**
 * Get all attendance summaries
 * Optional query params: ?eventId=&date=
 */
eventRouter.get(
  "/church-attendance",
  [protect, permissions.can_view_church_attendance],
  eventContoller.getAttendances,
);

/**
 * Get attendance summary by ID
 * Uses query param ?id=
 */
eventRouter.get(
  "/church-attendance/by-id",
  [protect, permissions.can_view_church_attendance],
  eventContoller.getAttendanceById,
);

/**
 * Update attendance summary by ID
 * Uses URL param :id
 */
eventRouter.put(
  "/church-attendance",
  [protect, permissions.can_manage_church_attendance],
  eventContoller.updateAttendance,
);

/**
 * Delete attendance summary by ID
 * Uses URL param :id
 */
eventRouter.delete(
  "/church-attendance",
  [protect, permissions.can_delete_church_attendance],
  eventContoller.deleteAttendance,
);
