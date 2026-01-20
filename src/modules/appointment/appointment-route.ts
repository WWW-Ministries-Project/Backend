import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { AppointmentController } from "./appointment-controller";

const permissions = new Permissions();
const protect = permissions.protect;

const appointmentRouter = Router();
const appointmentController = new AppointmentController();



// 1. Members book an appointment
// URL: POST /appointment/book
appointmentRouter.post('/book', appointmentController.bookNow);

// 2. Fetch bookings for a client (Expects ?email=user@example.com)
// URL: GET /appointment/client
appointmentRouter.get('/client', appointmentController.getClientBookings);


// 3. Staff sets availability (Wipes old slots and creates new ones)
// URL: POST /appointment/availability
appointmentRouter.post('/availability', appointmentController.setAvailability);

// 4. Fetch bookings for staff (Expects ?userId=123)
// URL: GET /appointment/staff
appointmentRouter.get('/staff', appointmentController.getStaffBookings);

// 5. Update status (Expects ?id=456 in query and { isConfirmed: boolean } in body)
// URL: PUT /appointment/status
appointmentRouter.put('/status', appointmentController.toggleConfirmation);

export default appointmentRouter;