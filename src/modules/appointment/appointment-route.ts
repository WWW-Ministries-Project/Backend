import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { AppointmentController } from "./appointment-controller";
import { AppointmentReasonController } from "./appointment-reason-controller";
import {
  applyAppointmentViewScope,
  guardAvailabilityChange,
  guardBookingChange,
  requireAppointmentConfigure,
} from "./appointment-access";

const permissions = new Permissions();
const protect = permissions.protect;
// Reads: the scoped view guard, then the role's own/branch scope (§7.12).
const viewScoped = [protect, permissions.can_view_appointments_scoped, applyAppointmentViewScope];

const appointmentRouter = Router();
const appointmentController = new AppointmentController();
const reasonController = new AppointmentReasonController();

// 1. Members book an appointment
// URL: POST /appointment/book
// `withAccess` (any signed-in user) gives the controller the live,
// active-branch role for booking on someone's behalf.
appointmentRouter.post("/book", [protect, permissions.withAccess], appointmentController.bookNow);

// 2. Fetch all booking appointments (supports ?attendeeId=, ?requesterId=, ?email=, ?status=, ?date=YYYY-MM-DD)
// URL: GET /appointment/bookings
appointmentRouter.get(
  "/bookings",
  viewScoped,
  appointmentController.getBookings,
);

// 3. Fetch one booking appointment by id
// URL: GET /appointment/bookings/:id
appointmentRouter.get(
  "/bookings/:id",
  viewScoped,
  appointmentController.getBookingById,
);

// 4. Update booking appointment by id
// URL: PUT /appointment/bookings/:id
appointmentRouter.put(
  "/bookings/:id",
  [protect, permissions.can_manage_appointments_scoped, guardBookingChange()],
  appointmentController.updateBooking,
);

// 4b. The requester cancels their own booking
// URL: PUT /appointment/bookings/:id/cancel
// `protect`-only: ownership (requesterId === caller) is checked in the
// controller, since the scoped manage guard would reject a plain member.
appointmentRouter.put(
  "/bookings/:id/cancel",
  [protect],
  appointmentController.cancelOwnBooking,
);

// 4c. Booking actions (appointments redesign)
// URL: POST /appointment/bookings/:id/actions
// Body: { action: "accept" | "reopen" | "suggest" | "decline" | "cancel" |
//   "complete" | "no_show" | "remind" | "reassign" | "confirm_proposal", ... }
// `protect`-only: the person booked may act on their own booking; manage
// (and manage-only actions) is checked in the action service.
appointmentRouter.post(
  "/bookings/:id/actions",
  [protect, permissions.withAccess],
  appointmentController.bookingAction,
);

// 5. Delete booking appointment by id
// URL: DELETE /appointment/bookings/:id
appointmentRouter.delete(
  "/bookings/:id",
  [
    protect,
    permissions.requireAction("Appointments", "delete", "Not authorized to delete appointments"),
    guardBookingChange(),
  ],
  appointmentController.deleteBooking,
);

// 6. Fetch bookings for a client (Expects ?email=user@example.com)
// URL: GET /appointment/client
appointmentRouter.get(
  "/client",
  viewScoped,
  appointmentController.getClientBookings,
);

// 7. Staff sets availability (Wipes old slots and creates new ones)
// URL: POST /appointment/availability
// Own schedule: manage_own_availability (View); anyone else's:
// manage_others_availability (Manage). See appointment-access.ts.
appointmentRouter.post(
  "/availability",
  [protect, permissions.withAccess, guardAvailabilityChange()],
  appointmentController.setAvailability,
);

// 8. Fetch all created availability (optional ?userId=123)
// URL: GET /appointment/availability
appointmentRouter.get(
  "/availability",
  viewScoped,
  appointmentController.getAvailability,
);

// 9. Fetch users with daily sessions and booking status tags
// (supports optional ?date=YYYY-MM-DD and ?category=)
// URL: GET /appointment/availability/status
appointmentRouter.get(
  "/availability/status",
  viewScoped,
  appointmentController.getAvailabilityStatus,
);

// 9b. Fetch the full booking-options staff list (same payload as #9, but
// `protect`-only — no `can_view_appointments_scoped` — so any authenticated
// member sees every staff member's slots, not just their own "own"-scoped
// availability, when picking who to book with). Payload carries no other
// member's identity or appointment details, so opening it is safe.
// URL: GET /appointment/availability/booking-options
appointmentRouter.get(
  "/availability/booking-options",
  [protect],
  appointmentController.getBookingOptions,
);

// 9c. Pause / resume new bookings for a person. Body: { paused: boolean }
// URL: PUT /appointment/availability/staff/:userId/pause
appointmentRouter.put(
  "/availability/staff/:userId/pause",
  [protect, permissions.withAccess, guardAvailabilityChange()],
  appointmentController.setStaffPaused,
);

// 9d. Add time off for a person. Body: { from, to, note? } (YYYY-MM-DD, inclusive)
// URL: POST /appointment/availability/staff/:userId/time-off
appointmentRouter.post(
  "/availability/staff/:userId/time-off",
  [protect, permissions.withAccess, guardAvailabilityChange()],
  appointmentController.createTimeOff,
);

// 9e. Remove a time-off entry
// URL: DELETE /appointment/availability/time-off/:id
appointmentRouter.delete(
  "/availability/time-off/:id",
  [protect, permissions.withAccess, guardAvailabilityChange()],
  appointmentController.deleteTimeOff,
);

// 10. Update one availability slot by id
// URL: PUT /appointment/availability/:id
appointmentRouter.put(
  "/availability/:id",
  [protect, permissions.withAccess, guardAvailabilityChange()],
  appointmentController.updateAvailability,
);

// 11. Delete one availability slot by id
// URL: DELETE /appointment/availability/:id
appointmentRouter.delete(
  "/availability/:id",
  // Removing one of your own slots is part of managing your own schedule;
  // anyone else's stays a Full delete.
  [protect, permissions.withAccess, guardAvailabilityChange("delete")],
  appointmentController.deleteAvailability,
);

// 12. Fetch bookings for staff (Expects ?userId=123)
// URL: GET /appointment/staff
appointmentRouter.get(
  "/staff",
  viewScoped,
  appointmentController.getStaffBookings,
);

// 13. Update status (Expects ?id=456 in query and { isConfirmed: boolean } in body)
// URL: PUT /appointment/status
appointmentRouter.put(
  "/status",
  [protect, permissions.can_manage_appointments_scoped, guardBookingChange("respond")],
  appointmentController.toggleConfirmation,
);

// 14. Booking reasons — admin-configured list members pick from when booking.
// "Something else" is client-side free text and is never stored here.
// `/reasons/manage` and `/reasons/reorder` are registered before
// `/reasons/:id` so they are not captured as an id.

// 14a. Active reasons, ordered by sort_order then id. Every member books, so
// `protect` only.
// URL: GET /appointment/reasons
appointmentRouter.get("/reasons", [protect], reasonController.listActive);

// 14b. All reasons, including inactive ones (admin screen)
// URL: GET /appointment/reasons/manage
appointmentRouter.get(
  "/reasons/manage",
  [protect, permissions.can_manage_appointment_settings],
  reasonController.listAll,
);

// 14c. Create a reason; it goes to the end of the list
// Body: { label, description?, is_active? }
// URL: POST /appointment/reasons
appointmentRouter.post(
  "/reasons",
  [protect, permissions.withAccess, requireAppointmentConfigure],
  reasonController.create,
);

// 14d. Reorder: sort_order = index in `ids`
// Body: { ids: number[] }
// URL: PUT /appointment/reasons/reorder
appointmentRouter.put(
  "/reasons/reorder",
  [protect, permissions.withAccess, requireAppointmentConfigure],
  reasonController.reorder,
);

// 14e. Partial update. Body: { label?, description?, is_active? }
// URL: PUT /appointment/reasons/:id
appointmentRouter.put(
  "/reasons/:id",
  [protect, permissions.withAccess, requireAppointmentConfigure],
  reasonController.update,
);

// 14f. Delete a reason
// URL: DELETE /appointment/reasons/:id
appointmentRouter.delete(
  "/reasons/:id",
  [protect, permissions.withAccess, requireAppointmentConfigure],
  reasonController.remove,
);

// 15. Appointment rules + notification matrix (appointments redesign).
// GET with view (any signed-in user passes the scoped view guard; members
// need the cancel cutoff and booking rules too). PUT takes any subset and
// returns the full object.
// URL: GET /appointment/settings
appointmentRouter.get(
  "/settings",
  viewScoped,
  appointmentController.getSettings,
);

// URL: PUT /appointment/settings
appointmentRouter.put(
  "/settings",
  [protect, permissions.withAccess, requireAppointmentConfigure],
  appointmentController.updateSettings,
);

export default appointmentRouter;
