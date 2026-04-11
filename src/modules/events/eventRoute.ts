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

eventRouter.get(
  "/public-event",
  eventContoller.publicEventDetails,
);

eventRouter.post(
  "/public-validate-member",
  eventContoller.validatePublicMemberRegistration,
);

eventRouter.post(
  "/public-register",
  eventContoller.publicRegister,
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

// ─── Series delete ────────────────────────────────────────────────────────────
// DELETE /event/delete-series?series_id=<uuid>            → all occurrences
// DELETE /event/delete-series-from?series_id=<uuid>&from_date=YYYY-MM-DD  → this + following
eventRouter.delete(
  "/delete-series",
  [protect, permissions.can_delete_events],
  eventContoller.deleteEventSeries,
);
eventRouter.delete(
  "/delete-series-from",
  [protect, permissions.can_delete_events],
  eventContoller.deleteEventSeriesFrom,
);

// ─── Series update ────────────────────────────────────────────────────────────
// PUT /event/update-series       body: { series_id, ...fields }
// PUT /event/update-series-from  body: { series_id, from_date, ...fields }
eventRouter.put(
  "/update-series",
  [protect, permissions.can_manage_events],
  eventContoller.updateEventSeries,
);
eventRouter.put(
  "/update-series-from",
  [protect, permissions.can_manage_events],
  eventContoller.updateEventSeriesFrom,
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

eventRouter.post("/register", [protect], eventContoller.register);
eventRouter.get(
  "/get-registered-event-members",
  [protect, permissions.can_view_events],
  eventContoller.allRegisteredMembers,
);
eventRouter.get(
  "/all-registered-event-member",
  [protect, permissions.can_view_events],
  eventContoller.registeredMember,
);

eventRouter.post(
  "/import-biometric-attendance",
  [protect, permissions.can_manage_church_attendance],
  eventContoller.importBiometricAttendance,
);

eventRouter.get(
  "/import-biometric-attendance-job",
  [protect, permissions.can_view_church_attendance],
  eventContoller.getBiometricAttendanceImportJob,
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

eventRouter.get(
  "/biometric-attendance",
  [protect, permissions.can_view_church_attendance],
  eventContoller.getBiometricAttendances,
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

// ─── iCal export ─────────────────────────────────────────────────────────────
// GET /event/ical-export?event_id=123   → downloads a single event as .ics
// GET /event/ical-export?series_id=<uuid> → downloads all occurrences in a series
eventRouter.get("/ical-export", [protect], eventContoller.icalExport);

// ─── Event reminders ─────────────────────────────────────────────────────────
// GET    /event/reminders?event_id=123          → list reminders for event
// POST   /event/reminders  { event_id, reminders: [15, 60, 1440] }  → create/replace
// DELETE /event/reminders?id=<reminder_id>      → cancel a single reminder
eventRouter.get("/reminders", [protect], eventContoller.getEventReminders);
eventRouter.post(
  "/reminders",
  [protect, permissions.can_manage_events],
  eventContoller.upsertEventReminders,
);
eventRouter.delete(
  "/reminders",
  [protect, permissions.can_manage_events],
  eventContoller.cancelReminder,
);
