import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { AppointmentController } from "./appointment-controller";

const permissions = new Permissions();
const protect = permissions.protect;

const appointmentRouter = Router();
const appointmentController = new AppointmentController();

// 1. Members book an appointment
// URL: POST /appointment/book
appointmentRouter.post("/book", [protect], appointmentController.bookNow);

// 2. Fetch all booking appointments (supports ?attendeeId=, ?requesterId=, ?email=, ?status=, ?date=YYYY-MM-DD)
// URL: GET /appointment/bookings
appointmentRouter.get(
  "/bookings",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getBookings,
);

// 3. Fetch one booking appointment by id
// URL: GET /appointment/bookings/:id
appointmentRouter.get(
  "/bookings/:id",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getBookingById,
);

// 4. Update booking appointment by id
// URL: PUT /appointment/bookings/:id
appointmentRouter.put(
  "/bookings/:id",
  [protect, permissions.can_manage_appointments_scoped],
  appointmentController.updateBooking,
);

// 5. Delete booking appointment by id
// URL: DELETE /appointment/bookings/:id
appointmentRouter.delete(
  "/bookings/:id",
  [protect, permissions.can_delete_appointments_scoped],
  appointmentController.deleteBooking,
);

// 6. Fetch bookings for a client (Expects ?email=user@example.com)
// URL: GET /appointment/client
appointmentRouter.get(
  "/client",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getClientBookings,
);

// 7. Staff sets availability (Wipes old slots and creates new ones)
// URL: POST /appointment/availability
appointmentRouter.post(
  "/availability",
  [protect, permissions.can_manage_appointments_scoped],
  appointmentController.setAvailability,
);

// 8. Fetch all created availability (optional ?userId=123)
// URL: GET /appointment/availability
appointmentRouter.get(
  "/availability",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getAvailability,
);

// 9. Fetch users with daily sessions and booking status tags
// URL: GET /appointment/availability/status
appointmentRouter.get(
  "/availability/status",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getAvailabilityStatus,
);

// 10. Update one availability slot by id
// URL: PUT /appointment/availability/:id
appointmentRouter.put(
  "/availability/:id",
  [protect, permissions.can_manage_appointments_scoped],
  appointmentController.updateAvailability,
);

// 11. Delete one availability slot by id
// URL: DELETE /appointment/availability/:id
appointmentRouter.delete(
  "/availability/:id",
  [protect, permissions.can_delete_appointments_scoped],
  appointmentController.deleteAvailability,
);

// 12. Fetch bookings for staff (Expects ?userId=123)
// URL: GET /appointment/staff
appointmentRouter.get(
  "/staff",
  [protect, permissions.can_view_appointments_scoped],
  appointmentController.getStaffBookings,
);

// 13. Update status (Expects ?id=456 in query and { isConfirmed: boolean } in body)
// URL: PUT /appointment/status
appointmentRouter.put(
  "/status",
  [protect, permissions.can_manage_appointments_scoped],
  appointmentController.toggleConfirmation,
);

export default appointmentRouter;
