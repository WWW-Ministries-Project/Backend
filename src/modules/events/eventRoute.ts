import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { eventManagement } from "../events/eventContoller";
import { requireEventsAction } from "./eventAccess";
import {
  requireBranchWideAttendance,
  requireRecordOfficialUnlessPreview,
} from "./attendanceAccess";
const eventContoller = new eventManagement();
const permissions = new Permissions();
const protect = permissions.protect;
const withAccess = permissions.withAccess;
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
  "/list-event-years",
  [protect],
  eventContoller.listEventYears,
);

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
  [protect, permissions.requireAction("Events", "create", "Not authorized to create events")],
  eventContoller.createEvent,
);

eventRouter.put(
  "/update-event",
  [protect, permissions.requireAction("Events", "edit", "Not authorized to edit events")],
  eventContoller.updateEvent,
);

// PUT /event/online-links?id=<event_id>
// body: { links: [ { platform: "zoom", url: "https://..." }, ... ] }
// An entry with an empty url removes that platform's link.
eventRouter.put(
  "/online-links",
  [protect, permissions.requireAction("Events", "manage_online_links", "Not authorized to change online links")],
  eventContoller.updateOnlineLinks,
);

eventRouter.delete(
  "/delete-event",
  [protect, permissions.requireAction("Events", "delete", "Not authorized to delete events")],
  eventContoller.deleteEvent,
);

// ─── Series delete ────────────────────────────────────────────────────────────
// DELETE /event/delete-series?series_id=<uuid>            → all occurrences
// DELETE /event/delete-series-from?series_id=<uuid>&from_date=YYYY-MM-DD  → this + following
eventRouter.delete(
  "/delete-series",
  [protect, permissions.requireAction("Events", "delete", "Not authorized to delete events")],
  eventContoller.deleteEventSeries,
);
eventRouter.delete(
  "/delete-series-from",
  [protect, permissions.requireAction("Events", "delete", "Not authorized to delete events")],
  eventContoller.deleteEventSeriesFrom,
);

// ─── Series update ────────────────────────────────────────────────────────────
// PUT /event/update-series       body: { series_id, ...fields }
// PUT /event/update-series-from  body: { series_id, from_date, ...fields }
eventRouter.put(
  "/update-series",
  [protect, permissions.requireAction("Events", "manage_series", "Not authorized to edit event series")],
  eventContoller.updateEventSeries,
);
eventRouter.put(
  "/update-series-from",
  [protect, permissions.requireAction("Events", "manage_series", "Not authorized to edit event series")],
  eventContoller.updateEventSeriesFrom,
);

// Staff check-in: creates people and attendance, and looks members up by
// phone, so it needs a signed-in Events manager (no client calls these today).
eventRouter.post(
  "/sign-attendance",
  [protect, permissions.can_manage_events],
  eventContoller.eventAttendance,
);
eventRouter.get(
  "/search-user",
  [protect, permissions.can_manage_events],
  eventContoller.searchUser1,
);

eventRouter.post(
  "/create-event-type",
  [protect, withAccess, requireEventsAction("manage_types", "Not authorized to manage event types", "manage")],
  eventContoller.createEventType,
);
eventRouter.put(
  "/update-event-type",
  [protect, withAccess, requireEventsAction("manage_types", "Not authorized to manage event types", "manage")],
  eventContoller.updateEventType,
);
eventRouter.get("/get-event-type", [protect], eventContoller.getEventType);
eventRouter.get("/get-event-types", [protect], eventContoller.getEventTypes);
eventRouter.delete(
  "/delete-event-type",
  [protect, permissions.can_delete_events, requireEventsAction("manage_types", "Not authorized to manage event types")],
  eventContoller.deleteEventType,
);

eventRouter.post("/register", [protect], eventContoller.register);
eventRouter.get(
  "/get-registered-event-members",
  [protect, permissions.requireAction("Events", "view_registrations", "Not authorized to view registrations")],
  eventContoller.allRegisteredMembers,
);
eventRouter.get(
  "/all-registered-event-member",
  [protect, permissions.requireAction("Events", "view_registrations", "Not authorized to view registrations")],
  eventContoller.registeredMember,
);

eventRouter.post(
  "/stage-biometric-attendance",
  [protect, permissions.requireAction("Church_Attendance", "import_biometric", "Not authorized to import check-ins"), requireRecordOfficialUnlessPreview],
  eventContoller.stageBiometricAttendance,
);

eventRouter.post(
  "/biometric-attendance-upload-intent",
  [protect, permissions.requireAction("Church_Attendance", "import_biometric", "Not authorized to import check-ins")],
  eventContoller.createBiometricAttendanceUploadIntent,
);

eventRouter.post(
  "/stage-biometric-attendance-from-upload",
  [protect, permissions.requireAction("Church_Attendance", "import_biometric", "Not authorized to import check-ins"), requireRecordOfficialUnlessPreview],
  eventContoller.importBiometricAttendanceFromUpload,
);

eventRouter.post(
  "/import-biometric-attendance",
  [protect, permissions.requireAction("Church_Attendance", "import_biometric", "Not authorized to import check-ins"), requireRecordOfficialUnlessPreview],
  eventContoller.importBiometricAttendance,
);

eventRouter.get(
  "/import-biometric-attendance-job",
  [protect, permissions.can_view_church_attendance_scoped],
  eventContoller.getBiometricAttendanceImportJob,
);

/**
 * Create attendance summary
 */
eventRouter.post(
  "/church-attendance",
  [
    protect,
    permissions.requireAction("Church_Attendance", "record", "Not authorized to record attendance"),
    requireBranchWideAttendance,
  ],
  eventContoller.createAttendanceSummary,
);

/**
 * Get all attendance summaries
 * Optional query params: ?eventId=&date=
 */
eventRouter.get(
  "/church-attendance",
  [protect, permissions.can_view_church_attendance_scoped],
  eventContoller.getAttendances,
);

eventRouter.get(
  "/biometric-attendance",
  [protect, permissions.can_view_church_attendance_scoped],
  eventContoller.getBiometricAttendances,
);

/**
 * Get attendance summary by ID
 * Uses query param ?id=
 */
eventRouter.get(
  "/church-attendance/by-id",
  [protect, permissions.can_view_church_attendance_scoped],
  eventContoller.getAttendanceById,
);

/**
 * Update attendance summary by ID
 * Uses URL param :id
 */
eventRouter.put(
  "/church-attendance",
  [
    protect,
    permissions.requireAction("Church_Attendance", "record", "Not authorized to edit attendance"),
    requireBranchWideAttendance,
  ],
  eventContoller.updateAttendance,
);

/**
 * Delete attendance summary by ID
 * Uses URL param :id
 */
eventRouter.delete(
  "/church-attendance",
  [
    protect,
    permissions.requireAction("Church_Attendance", "delete", "Not authorized to delete attendance"),
    requireBranchWideAttendance,
  ],
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
  [protect, permissions.requireAction("Events", "send_reminders", "Not authorized to set event reminders")],
  eventContoller.upsertEventReminders,
);
eventRouter.delete(
  "/reminders",
  [protect, permissions.requireAction("Events", "send_reminders", "Not authorized to cancel event reminders")],
  eventContoller.cancelReminder,
);
