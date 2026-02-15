import { Router } from "express";
import { appointmentController } from "./appointment-controller";

const appointmentRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Appointments
 *   description: Appointment availability and booking endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AppointmentSession:
 *       type: object
 *       required:
 *         - start
 *         - end
 *       properties:
 *         start:
 *           type: string
 *           example: "09:00"
 *         end:
 *           type: string
 *           example: "09:30"
 *     AvailabilityTimeSlot:
 *       type: object
 *       required:
 *         - day
 *         - startTime
 *         - endTime
 *         - sessionDurationMinutes
 *         - sessions
 *       properties:
 *         day:
 *           type: string
 *           example: "monday"
 *         startTime:
 *           type: string
 *           example: "09:00"
 *         endTime:
 *           type: string
 *           example: "12:00"
 *         sessionDurationMinutes:
 *           type: integer
 *           example: 30
 *         sessions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AppointmentSession'
 *     SaveAvailabilityRequest:
 *       type: object
 *       required:
 *         - staffId
 *         - maxBookingsPerSlot
 *         - timeSlots
 *       properties:
 *         staffId:
 *           type: string
 *           example: "1"
 *         maxBookingsPerSlot:
 *           type: integer
 *           example: 3
 *         timeSlots:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AvailabilityTimeSlot'
 *     StaffAvailability:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "avail-1"
 *         staffId:
 *           type: string
 *           example: "1"
 *         staffName:
 *           type: string
 *           example: "John Doe"
 *         position:
 *           type: string
 *           nullable: true
 *           example: "Senior Pastor"
 *         role:
 *           type: string
 *           nullable: true
 *           example: "Counsellor"
 *         maxBookingsPerSlot:
 *           type: integer
 *           example: 3
 *         timeSlots:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AvailabilityTimeSlot'
 *     BookAppointmentRequest:
 *       type: object
 *       required:
 *         - fullName
 *         - email
 *         - phone
 *         - purpose
 *         - staffId
 *         - date
 *         - session
 *       properties:
 *         fullName:
 *           type: string
 *           example: "Amy Graves"
 *         email:
 *           type: string
 *           example: "amy.graves@email.com"
 *         phone:
 *           type: string
 *           example: "+1 (588) 572-1813"
 *         purpose:
 *           type: string
 *           example: "Personal counselling"
 *         note:
 *           type: string
 *           example: "Follow-up on prior session"
 *         staffId:
 *           type: string
 *           example: "1"
 *         date:
 *           type: string
 *           format: date
 *           example: "2026-01-19"
 *         session:
 *           $ref: '#/components/schemas/AppointmentSession'
 *     AppointmentRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 11
 *         staffId:
 *           type: string
 *           example: "1"
 *         staffName:
 *           type: string
 *           example: "John Doe"
 *         position:
 *           type: string
 *           nullable: true
 *           example: "Senior Pastor"
 *         role:
 *           type: string
 *           nullable: true
 *           example: "Counsellor"
 *         fullName:
 *           type: string
 *           example: "Amy Graves"
 *         email:
 *           type: string
 *           example: "amy.graves@email.com"
 *         phone:
 *           type: string
 *           example: "+1 (588) 572-1813"
 *         purpose:
 *           type: string
 *           example: "Personal counselling"
 *         note:
 *           type: string
 *           example: "Follow-up on prior session"
 *         date:
 *           type: string
 *           format: date
 *           example: "2026-01-19"
 *         session:
 *           $ref: '#/components/schemas/AppointmentSession'
 *         status:
 *           type: string
 *           example: "Pending"
 *         statusCode:
 *           type: string
 *           enum: [PENDING, CONFIRMED, CANCELLED]
 *           example: "PENDING"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-01-20T10:15:00.000Z"
 *     AppointmentStatusUpdateRequest:
 *       type: object
 *       properties:
 *         isConfirmed:
 *           type: boolean
 *           example: true
 *         status:
 *           type: string
 *           enum: [CONFIRMED, PENDING]
 *           example: "CONFIRMED"
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: "Validation error"
 */

/**
 * @swagger
 * /appointment/availability:
 *   post:
 *     summary: Create or replace staff availability
 *     tags: [Appointments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SaveAvailabilityRequest'
 *     responses:
 *       200:
 *         description: Availability schedule updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Availability schedule updated"
 *                 data:
 *                   $ref: '#/components/schemas/StaffAvailability'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 2. Staff sets availability (Wipes old slots and creates new ones)
// URL: POST /appointment/availability
appointmentRouter.post("/availability", appointmentController.setAvailability);

/**
 * @swagger
 * /appointment/availability:
 *   get:
 *     summary: Fetch availability for all staff or one staff
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: staffId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Optional staff ID. If omitted, returns all staff availability.
 *     responses:
 *       200:
 *         description: Availability fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StaffAvailability'
 *       400:
 *         description: Invalid query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 3. Fetch availability for one/all staff (Expects optional ?staffId=123)
// URL: GET /appointment/availability
appointmentRouter.get("/availability", appointmentController.getAvailability);

/**
 * @swagger
 * /appointment/book:
 *   post:
 *     summary: Book an appointment
 *     tags: [Appointments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BookAppointmentRequest'
 *     responses:
 *       201:
 *         description: Appointment booked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Appointment booked successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: Booking failed due to validation or slot constraints
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 1. Members book an appointment
// URL: POST /appointment/book
appointmentRouter.post("/book", appointmentController.bookNow);

/**
 * @swagger
 * /appointment/staff:
 *   get:
 *     summary: Fetch appointments by staff
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: staffId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Staff ID to fetch bookings for
 *     responses:
 *       200:
 *         description: Staff bookings fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: Invalid query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 4. Fetch bookings for staff (Expects ?staffId=123)
// URL: GET /appointment/staff
appointmentRouter.get("/staff", appointmentController.getStaffBookings);

/**
 * @swagger
 * /appointment/user:
 *   get:
 *     summary: Fetch appointments by user (booker)
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: false
 *         schema:
 *           type: string
 *         description: Booker email
 *       - in: query
 *         name: phone
 *         required: false
 *         schema:
 *           type: string
 *         description: Booker phone
 *     responses:
 *       200:
 *         description: User appointments fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: email or phone is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 5. Fetch bookings for a user (Expects ?email=user@example.com and/or ?phone=0200000000)
// URL: GET /appointment/user
appointmentRouter.get("/user", appointmentController.getUserBookings);

/**
 * @swagger
 * /appointment/client:
 *   get:
 *     summary: Fetch appointments by user (legacy alias)
 *     tags: [Appointments]
 *     deprecated: true
 *     parameters:
 *       - in: query
 *         name: email
 *         required: false
 *         schema:
 *           type: string
 *         description: Booker email
 *       - in: query
 *         name: phone
 *         required: false
 *         schema:
 *           type: string
 *         description: Booker phone
 *     responses:
 *       200:
 *         description: User appointments fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: email or phone is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 6. Backward-compatible alias for older clients
// URL: GET /appointment/client
appointmentRouter.get("/client", appointmentController.getUserBookings);

/**
 * @swagger
 * /appointment/status:
 *   put:
 *     summary: Confirm or unconfirm appointment by query ID
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Appointment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AppointmentStatusUpdateRequest'
 *     responses:
 *       200:
 *         description: Appointment status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Appointment confirmed successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Appointment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// 7. Update status (Expects ?id=456 in query and { isConfirmed: boolean } in body)
// URL: PUT /appointment/status
appointmentRouter.put("/status", appointmentController.toggleConfirmation);

/**
 * @swagger
 * /appointment/{id}/status:
 *   patch:
 *     summary: Confirm or unconfirm appointment by path ID
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Appointment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AppointmentStatusUpdateRequest'
 *     responses:
 *       200:
 *         description: Appointment status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Appointment unconfirmed successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AppointmentRecord'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Appointment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
appointmentRouter.patch("/:id/status", appointmentController.toggleConfirmation);

export default appointmentRouter;
