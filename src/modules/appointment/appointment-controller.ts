import { Request, Response } from "express";
import { appointment_status } from "@prisma/client";
import { AppointmentService } from "./appointment-service";

export class AppointmentController {
  /**
   * @route   POST /appointment/availability
   * @desc    Staff sets their recurring weekly availability and session slots
   */
  async setAvailability(req: Request, res: Response) {
    try {
      const appointment_availability =
        await AppointmentService.saveStaffAvailability(req.body);
      res.status(200).json({
        message: "Availability schedule updated",
        data: appointment_availability,
      });
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Could not save availability" });
    }
  }

  /**
   * @route   GET /appointment/availability?staffId=1
   * @desc    Fetch availability for all staff or one specific staff
   */
  async getAvailability(req: Request, res: Response) {
    try {
      const staffIdentifier = req.query.staffId ?? req.query.userId;

      const staffId =
        staffIdentifier !== undefined ? Number(staffIdentifier) : undefined;
      if (
        staffIdentifier !== undefined &&
        (!Number.isInteger(staffId) || Number(staffId) <= 0)
      ) {
        return res.status(400).json({ error: "staffId must be a valid number" });
      }

      const data = await AppointmentService.getAvailability(staffId);
      res.status(200).json({ data });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Could not fetch availability" });
    }
  }

  /**
   * @route   POST /appointment/book
   * @desc    Member/Client books a specific time slot
   */
  async bookNow(req: Request, res: Response) {
    try {
      const newBooking = await AppointmentService.createAppointment(req.body);
      res.status(201).json({
        message: "Appointment booked successfully",
        data: newBooking,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Booking failed" });
    }
  }

  /**
   * @route   GET /appointment/staff?staffId=1
   * @desc    Fetch all bookings for a specific staff member
   */
  async getStaffBookings(req: Request, res: Response) {
    try {
      const { staffId, userId } = req.query;
      const staffIdentifier = staffId ?? userId;
      if (!staffIdentifier) {
        return res
          .status(400)
          .json({ error: "staffId is required in query" });
      }

      const parsedStaffId = Number(staffIdentifier);
      if (!Number.isInteger(parsedStaffId) || parsedStaffId <= 0) {
        return res.status(400).json({ error: "staffId must be a valid number" });
      }

      const data = await AppointmentService.getByStaff(parsedStaffId);
      res.status(200).json({ data });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Error fetching bookings" });
    }
  }

  /**
   * @route   GET /appointment/user?email=test@mail.com&phone=0200000000
   * @desc    Fetch appointments by booker (email and/or phone)
   */
  async getUserBookings(req: Request, res: Response) {
    try {
      const email =
        typeof req.query.email === "string" ? req.query.email : undefined;
      const phone =
        typeof req.query.phone === "string" ? req.query.phone : undefined;

      if (!email && !phone) {
        return res
          .status(400)
          .json({ error: "email or phone is required in query" });
      }

      const data = await AppointmentService.getByUser({ email, phone });
      res.status(200).json({ data });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Error fetching user appointments" });
    }
  }

  /**
   * @route   PUT /appointment/status?id=123
   * @route   PATCH /appointment/:id/status
   * @desc    Confirm or Unconfirm an appointment
   * @body    { "isConfirmed": true } OR { "status": "CONFIRMED" | "PENDING" }
   */
  async toggleConfirmation(req: Request, res: Response) {
    try {
      const idFromQuery =
        typeof req.query.id === "string" ? req.query.id : undefined;
      const idFromParam =
        typeof req.params.id === "string" ? req.params.id : undefined;
      const appointmentId = idFromQuery ?? idFromParam;

      if (!appointmentId) {
        return res
          .status(400)
          .json({ error: "Appointment ID is required in query or params" });
      }

      const parsedId = Number(appointmentId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return res
          .status(400)
          .json({ error: "Appointment ID must be a valid number" });
      }

      const { isConfirmed, status } = req.body as {
        isConfirmed?: boolean;
        status?: string;
      };

      let newStatus: appointment_status;
      if (typeof status === "string") {
        const normalized = status.toUpperCase();
        if (normalized !== "CONFIRMED" && normalized !== "PENDING") {
          return res
            .status(400)
            .json({ error: "status must be CONFIRMED or PENDING" });
        }
        newStatus = normalized;
      } else if (typeof isConfirmed === "boolean") {
        newStatus = isConfirmed ? "CONFIRMED" : "PENDING";
      } else {
        return res.status(400).json({
          error:
            "Provide isConfirmed (boolean) or status (CONFIRMED | PENDING)",
        });
      }

      const updated = await AppointmentService.updateStatus(
        parsedId,
        newStatus,
      );

      res.json({
        message:
          newStatus === "CONFIRMED"
            ? "Appointment confirmed successfully"
            : "Appointment unconfirmed successfully",
        data: updated,
      });
    } catch (error: any) {
      const statusCode =
        error?.message === "Appointment not found" ? 404 : 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Status update failed" });
    }
  }
}

export const appointmentController = new AppointmentController();
