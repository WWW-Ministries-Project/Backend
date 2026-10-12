import { Request, Response } from "express";
import { AppointmentReasonService } from "./appointment-reason-service";
import {
  parseReasonCreate,
  parseReasonId,
  parseReasonUpdate,
  parseReorderIds,
} from "./appointment-reason-validation";

/*
  Admin-configured reasons members pick from when booking. Errors are thrown
  (InputValidationError / NotFoundError) and shaped by the global handler —
  express-async-errors carries async throws there.
*/
export class AppointmentReasonController {
  /** @route GET /appointment/reasons — active reasons, any member. */
  async listActive(_req: Request, res: Response) {
    const data = await AppointmentReasonService.listActive();
    res.status(200).json({ message: "Appointment reasons fetched", data });
  }

  /** @route GET /appointment/reasons/manage — all reasons incl. inactive. */
  async listAll(_req: Request, res: Response) {
    const data = await AppointmentReasonService.listAll();
    res.status(200).json({ message: "Appointment reasons fetched", data });
  }

  /** @route POST /appointment/reasons */
  async create(req: Request, res: Response) {
    const data = await AppointmentReasonService.create(
      parseReasonCreate(req.body),
    );
    res.status(201).json({ message: "Appointment reason created", data });
  }

  /** @route PUT /appointment/reasons/:id */
  async update(req: Request, res: Response) {
    const id = parseReasonId(req.params.id);
    const data = await AppointmentReasonService.update(
      id,
      parseReasonUpdate(req.body),
    );
    res.status(200).json({ message: "Appointment reason updated", data });
  }

  /** @route DELETE /appointment/reasons/:id */
  async remove(req: Request, res: Response) {
    const data = await AppointmentReasonService.remove(
      parseReasonId(req.params.id),
    );
    res.status(200).json({ message: "Appointment reason deleted", data });
  }

  /** @route PUT /appointment/reasons/reorder — body { ids: number[] }. */
  async reorder(req: Request, res: Response) {
    const data = await AppointmentReasonService.reorder(
      parseReorderIds(req.body),
    );
    res.status(200).json({ message: "Appointment reasons reordered", data });
  }
}
