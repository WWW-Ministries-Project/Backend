import { Request, Response } from "express";
import {
  AppointmentForbiddenError,
  AppointmentService,
  SlotUnavailableError,
} from "./appointment-service";
import { notificationService } from "../notifications/notificationService";
import { canUserManageAppointments } from "../../middleWare/authorization";
import {
  AppError,
  InputValidationError,
} from "../../utils/custom-error-handlers";
import { performBookingAction } from "./appointment-actions";
import { AppointmentSettingsService } from "./appointment-settings";

const parsePositiveIdParam = (value: unknown, label: string) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InputValidationError(`${label} has to be a positive number.`);
  }
  return id;
};

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
      const statusCode =
        error?.message?.includes("must") || error?.message?.includes("required")
          ? 400
          : 500;
      res
        .status(statusCode)
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
      const appointmentScope = (req as any).appointmentScope;

      if (userId !== undefined) {
        const parsed = Number(userId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "userId must be a valid number" });
        }
      }

      const data = await AppointmentService.getAllAvailability(
        userId !== undefined ? Number(userId) : undefined,
        appointmentScope,
        req.query?.branch_id,
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
   * @route   GET /appointment/availability/status?date=YYYY-MM-DD&category=Something
   * @desc    Fetch availability in payload structure with slot/session status tags.
   *          ?date= pins every slot's status to that exact calendar date instead of
   *          each slot's own next matching weekday; ?category= filters to staff whose
   *          position category matches.
   */
  async getAvailabilityStatus(req: Request, res: Response) {
    try {
      const appointmentScope = (req as any).appointmentScope;
      const date =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const data =
        await AppointmentService.getAvailabilityWithSessionStatus(
          appointmentScope,
          req.query?.branch_id,
          { date, category },
        );

      res.status(200).json({
        message: "Availability status fetched successfully",
        data,
      });
    } catch (error: any) {
      const statusCode = error?.message?.includes("date") ? 400 : 500;
      res.status(statusCode).json({
        error: error.message || "Error fetching availability status",
      });
    }
  }

  /**
   * @route   GET /appointment/availability/booking-options?date=YYYY-MM-DD&category=Something
   * @desc    Same payload as `getAvailabilityStatus` (staff name/position/category,
   *          their time slots, and per-slot AVAILABLE/BOOKED status — no requester
   *          identity, no other members' appointment details), but unscoped: any
   *          authenticated member needs the *full* staff list to pick who to book
   *          with, not just their own ("own"-scoped) availability, which is what
   *          `can_view_appointments_scoped` narrows non-privileged callers to.
   *          Deliberately `protect`-only (no `can_view_appointments_scoped`) in the
   *          route — safe because the returned fields carry nothing scoped access
   *          was guarding in the first place.
   */
  async getBookingOptions(req: Request, res: Response) {
    try {
      const date =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const data =
        await AppointmentService.getAvailabilityWithSessionStatus(
          { mode: "all" },
          req.query?.branch_id,
          { date, category },
        );

      res.status(200).json({
        message: "Booking options fetched successfully",
        data,
      });
    } catch (error: any) {
      const statusCode = error?.message?.includes("date") ? 400 : 500;
      res.status(statusCode).json({
        error: error.message || "Error fetching booking options",
      });
    }
  }

  /**
   * @route   POST /api/appointments/book
   * @desc    Member/Client books a specific time slot
   */
  async bookNow(req: Request, res: Response) {
    try {
      const requesterId = Number((req as any).user?.id);
      if (!Number.isInteger(requesterId) || requesterId <= 0) {
        return res.status(401).json({ error: "Unauthorized user" });
      }

      // Booking for someone else or confirming straight away needs manage;
      // the service enforces it. Notifications follow the settings matrix.
      const wantsManagerOptions =
        (req.body?.requesterId !== undefined &&
          Number(req.body.requesterId) !== requesterId) ||
        String(req.body?.status ?? "").toUpperCase() === "CONFIRMED";
      const canManage = wantsManagerOptions
        ? await canUserManageAppointments(
            requesterId,
            Number(
              req.body?.userId ??
                req.body?.staffId ??
                req.body?.attendeeId ??
                req.body?.attendee_id,
            ) || null,
          )
        : false;

      const newBooking = await AppointmentService.createAppointment(
        req.body,
        requesterId,
        { canManage },
      );

      res.status(201).json({
        message: "Appointment booked successfully",
        data: newBooking,
      });
    } catch (error: any) {
      // Someone else got the session first: 409 + code, so clients refresh
      // the slot list rather than treating it as a bad request.
      if (error instanceof SlotUnavailableError) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      res.status(400).json({ error: error.message || "Booking failed" });
    }
  }

  /**
   * @route   GET /appointment/bookings
   * @desc    Fetch all booking appointments (supports staffId, requesterId, email, status, date filters)
   */
  async getBookings(req: Request, res: Response) {
    try {
      const appointmentScope = (req as any).appointmentScope;
      const staffIdRaw =
        req.query.staffId ??
        req.query.userId ??
        req.query.attendeeId ??
        req.query.attendee_id;
      const requesterIdRaw = req.query.requesterId ?? req.query.requestedBy;
      const email =
        typeof req.query.email === "string" ? req.query.email : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const date =
        typeof req.query.date === "string" ? req.query.date : undefined;

      let staffId: number | undefined;
      if (staffIdRaw !== undefined) {
        staffId = Number(staffIdRaw);
        if (!Number.isInteger(staffId) || staffId <= 0) {
          return res
            .status(400)
            .json({ error: "staffId must be a valid number" });
        }
      }

      let requesterId: number | undefined;
      if (requesterIdRaw !== undefined) {
        requesterId = Number(requesterIdRaw);
        if (!Number.isInteger(requesterId) || requesterId <= 0) {
          return res
            .status(400)
            .json({ error: "requesterId must be a valid number" });
        }
      }

      const data = await AppointmentService.getAllBookings({
        staffId,
        requesterId,
        email,
        status,
        date,
        branch_id: req.query?.branch_id,
      }, appointmentScope);

      res.status(200).json({
        message: "Bookings fetched successfully",
        data,
      });
    } catch (error: any) {
      const statusCode =
        error?.message?.includes("status must") ||
        error?.message?.includes("date")
          ? 400
          : 500;
      res.status(statusCode).json({
        error: error.message || "Error fetching bookings",
      });
    }
  }

  /**
   * @route   GET /appointment/bookings/:id
   * @desc    Fetch one booking appointment by id
   */
  async getBookingById(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Booking ID must be a valid number" });
      }

      const data = await AppointmentService.getBookingById(id);
      res.status(200).json({
        message: "Booking fetched successfully",
        data,
      });
    } catch (error: any) {
      const statusCode = error?.message === "Appointment not found" ? 404 : 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Error fetching booking" });
    }
  }

  /**
   * @route   PUT /appointment/bookings/:id
   * @desc    Update a booking appointment
   */
  async updateBooking(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Booking ID must be a valid number" });
      }

      const data = await AppointmentService.updateBooking(
        id,
        req.body,
        Number((req as any).user?.id) || undefined,
      );
      res.status(200).json({
        message: "Booking updated successfully",
        data,
      });
    } catch (error: any) {
      if (error instanceof SlotUnavailableError) {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      const statusCode =
        error?.message === "Appointment not found"
          ? 404
          : error?.message?.includes("must") ||
              error?.message?.includes("required") ||
              error?.message?.includes("already booked") ||
              error?.message?.includes("max number")
            ? 400
            : 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Error updating booking" });
    }
  }

  /**
   * @route   PUT /appointment/bookings/:id/cancel
   * @desc    The member who requested a booking cancels it. Only the
   *          requester may; staff keep using PUT /status and DELETE.
   */
  async cancelOwnBooking(req: Request, res: Response) {
    try {
      const callerId = Number((req as any).user?.id);
      if (!Number.isInteger(callerId) || callerId <= 0) {
        return res.status(401).json({ error: "Unauthorized user" });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Booking ID must be a valid number" });
      }

      // Ownership, state and the cancel cutoff (settings.cancelCutoffHours)
      // are checked in the service; it also writes history and notifies.
      const updated = await AppointmentService.cancelByRequester(id, callerId);

      res.status(200).json({ message: "Appointment cancelled successfully", data: updated });
    } catch (error: any) {
      const statusCode =
        error instanceof AppError
          ? error.statusCode
          : error instanceof AppointmentForbiddenError
            ? 403
            : 500;
      res.status(statusCode).json({ error: error.message || "Cancellation failed" });
    }
  }

  /**
   * @route   DELETE /appointment/bookings/:id
   * @desc    Delete a booking appointment
   */
  async deleteBooking(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Booking ID must be a valid number" });
      }

      const data = await AppointmentService.deleteBooking(id);
      res.status(200).json({
        message: "Booking deleted successfully",
        data,
      });
    } catch (error: any) {
      const statusCode = error?.message === "Appointment not found" ? 404 : 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Error deleting booking" });
    }
  }

  /**
   * @route   GET /api/appointments/staff?userId=1
   * @desc    Fetch all bookings for a specific staff member
   */
  async getStaffBookings(req: Request, res: Response) {
    try {
      const appointmentScope = (req as any).appointmentScope;
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "userId is required in query" });
      }
      const data = await AppointmentService.getByStaff(
        Number(userId),
        appointmentScope,
      );
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
      const appointmentScope = (req as any).appointmentScope;
      const { email } = req.query;
      if (!email) {
        return res.status(400).json({ error: "email is required in query" });
      }
      const data = await AppointmentService.getByClientEmail(
        String(email),
        appointmentScope,
      );
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
      const parsedId = Number(id);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return res
          .status(400)
          .json({ error: "Appointment ID must be a valid number" });
      }
      if (typeof isConfirmed !== "boolean") {
        return res
          .status(400)
          .json({ error: "isConfirmed must be a boolean value" });
      }

      const newStatus = isConfirmed ? "CONFIRMED" : "PENDING";
      const actorUserId = Number((req as any)?.user?.id);
      const updated = await AppointmentService.updateStatus(
        parsedId,
        newStatus,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : undefined,
      );
      const statusWord = newStatus.toLowerCase();

      const recipientUserIds = Array.from(
        new Set(
          [updated.requesterId, updated.staffId]
            .map((entry) => Number(entry))
            .filter(
              (entry): entry is number =>
                Number.isInteger(entry) &&
                entry > 0 &&
                entry !== actorUserId,
            ),
        ),
      );

      if (recipientUserIds.length) {
        await notificationService.createManyInAppNotifications(
          recipientUserIds.map((recipientUserId) => ({
            type: "appointment.status_changed",
            title: "Appointment status updated",
            body: `Appointment on ${updated.date} (${updated.session.start} - ${updated.session.end}) is now ${statusWord}.`,
            recipientUserId,
            actorUserId:
              Number.isInteger(actorUserId) && actorUserId > 0
                ? actorUserId
                : null,
            entityType: "APPOINTMENT",
            entityId: String(updated.id),
            actionUrl:
              recipientUserId === Number(updated.requesterId)
                ? "/member/appointments"
                : "/home/appointments",
            priority: "MEDIUM",
            dedupeKey: `appointment:${updated.id}:status:${newStatus}:recipient:${recipientUserId}`,
            emailSubject: `Appointment ${newStatus === "CONFIRMED" ? "Confirmed" : "Updated"}`,
            sendSms: true,
            smsBody: `Appointment on ${updated.date} (${updated.session.start} - ${updated.session.end}) is now ${statusWord}.`,
          })),
        );
      }

      res.json({
        message: `Appointment ${newStatus.toLowerCase()} successfully`,
        data: updated,
        notification: {
          sent: true,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Status update failed" });
    }
  }

  /*
   * Appointments redesign. These throw (InputValidationError, NotFoundError,
   * AppError) and let the global handler answer `{ message, data: null }`.
   */

  /**
   * @route POST /appointment/bookings/:id/actions
   * @body  { action, ...fields } — see appointment-actions.ts
   */
  async bookingAction(req: Request, res: Response) {
    const callerId = Number((req as any).user?.id);
    if (!Number.isInteger(callerId) || callerId <= 0) {
      return res.status(401).json({ error: "Unauthorized user" });
    }
    const id = parsePositiveIdParam(req.params.id, "Booking ID");
    const data = await performBookingAction(id, callerId, req.body);
    res.status(200).json({ message: "Appointment updated", data });
  }

  /** @route PUT /appointment/availability/staff/:userId/pause — body { paused } */
  async setStaffPaused(req: Request, res: Response) {
    const userId = parsePositiveIdParam(req.params.userId, "User ID");
    const data = await AppointmentService.setStaffPaused(userId, req.body?.paused);
    res.status(200).json({
      message: data.paused ? "Bookings paused" : "Bookings resumed",
      data,
    });
  }

  /** @route POST /appointment/availability/staff/:userId/time-off — body { from, to, note? } */
  async createTimeOff(req: Request, res: Response) {
    const userId = parsePositiveIdParam(req.params.userId, "User ID");
    const data = await AppointmentService.createTimeOff(
      userId,
      req.body,
      Number((req as any).user?.id) || undefined,
    );
    res.status(201).json({ message: "Time off added", data });
  }

  /** @route DELETE /appointment/availability/time-off/:id */
  async deleteTimeOff(req: Request, res: Response) {
    const id = parsePositiveIdParam(req.params.id, "Time off ID");
    const data = await AppointmentService.deleteTimeOff(id);
    res.status(200).json({ message: "Time off removed", data });
  }

  /** @route GET /appointment/settings */
  async getSettings(_req: Request, res: Response) {
    const data = await AppointmentSettingsService.get();
    res.status(200).json({ message: "Appointment settings fetched", data });
  }

  /** @route PUT /appointment/settings — any subset; returns the full object */
  async updateSettings(req: Request, res: Response) {
    const data = await AppointmentSettingsService.update(
      req.body,
      Number((req as any).user?.id) || null,
    );
    res.status(200).json({ message: "Appointment settings saved", data });
  }
}

// Export a single instance to use in routes
export const appointmentController = new AppointmentController();
