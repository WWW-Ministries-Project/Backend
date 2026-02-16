import { Request, Response } from "express";
import { AppointmentService } from "./appointment-service";

export class AppointmentController {
  /**
   * @route   POST /api/appointments/availability
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
        .status(500)
        .json({ error: error.message || "Could not save availability" });
    }
  }

  /**
   * @route   GET /api/appointments/availability?userId=1
   * @desc    Fetch all created availability records (optionally by staff userId)
   */
  async getAvailability(req: Request, res: Response) {
    try {
      const { userId } = req.query;

      if (userId !== undefined) {
        const parsed = Number(userId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "userId must be a valid number" });
        }
      }

      const data = await AppointmentService.getAllAvailability(
        userId !== undefined ? Number(userId) : undefined,
      );

      res.status(200).json({
        message: "Availability fetched successfully",
        data,
      });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: error.message || "Error fetching availability" });
    }
  }

  /**
   * @route   PUT /api/appointments/availability/:id
   * @desc    Update a created availability slot
   */
  async updateAvailability(req: Request, res: Response) {
    try {
      const parsedId = Number(req.params.id);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return res
          .status(400)
          .json({ error: "Availability ID must be a valid number" });
      }

      const data = await AppointmentService.updateAvailability(
        parsedId,
        req.body,
      );

      res.status(200).json({
        message: "Availability updated successfully",
        data,
      });
    } catch (error: any) {
      const statusCode =
        error?.message === "Availability not found"
          ? 404
          : error?.message?.includes("must")
            ? 400
            : 500;

      res
        .status(statusCode)
        .json({ error: error.message || "Could not update availability" });
    }
  }

  /**
   * @route   DELETE /api/appointments/availability/:id
   * @desc    Delete a created availability slot
   */
  async deleteAvailability(req: Request, res: Response) {
    try {
      const parsedId = Number(req.params.id);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return res
          .status(400)
          .json({ error: "Availability ID must be a valid number" });
      }

      const data = await AppointmentService.deleteAvailability(parsedId);
      res.status(200).json({
        message: "Availability deleted successfully",
        data,
      });
    } catch (error: any) {
      const statusCode = error?.message === "Availability not found" ? 404 : 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Could not delete availability" });
    }
  }

  /**
   * @route   GET /appointment/availability/status
   * @desc    Fetch users with today's sessions and booking status tags
   */
  async getAvailabilityStatus(req: Request, res: Response) {
    try {
      const data = await AppointmentService.getAvailabilityWithSessionStatus();

      res.status(200).json({
        message: "Availability status fetched successfully",
        data,
      });
    } catch (error: any) {
      res.status(500).json({
        error: error.message || "Error fetching availability status",
      });
    }
  }

  /**
   * @route   POST /api/appointments/book
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
      // If the overbooking logic throws an error, it will be caught here
      res.status(400).json({ error: error.message || "Booking failed" });
    }
  }

  /**
   * @route   GET /api/appointments/staff?userId=1
   * @desc    Fetch all bookings for a specific staff member
   */
  async getStaffBookings(req: Request, res: Response) {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "userId is required in query" });
      }
      const data = await AppointmentService.getByStaff(Number(userId));
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Error fetching bookings" });
    }
  }

  /**
   * @route   GET /api/appointments/client?email=test@mail.com
   * @desc    Fetch all bookings made by a specific user email
   */
  async getClientBookings(req: Request, res: Response) {
    try {
      const { email } = req.query;
      if (!email) {
        return res.status(400).json({ error: "email is required in query" });
      }
      const data = await AppointmentService.getByClientEmail(String(email));
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Error fetching user appointments" });
    }
  }

  /**
   * @route   PATCH /api/appointments/status?id=123
   * @desc    Confirm or Unconfirm an appointment
   * @body    { "isConfirmed": true }
   */
  async toggleConfirmation(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const { isConfirmed } = req.body;

      if (!id) {
        return res
          .status(400)
          .json({ error: "Appointment ID is required in query" });
      }

      const newStatus = isConfirmed ? "CONFIRMED" : "PENDING";
      const updated = await AppointmentService.updateStatus(
        Number(id),
        newStatus,
      );

      res.json({
        message: `Appointment ${newStatus.toLowerCase()} successfully`,
        data: updated,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Status update failed" });
    }
  }
}

// Export a single instance to use in routes
export const appointmentController = new AppointmentController();
