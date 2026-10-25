import { Request, Response } from "express";
import {
  lifeCenterMeetingService,
  NewFirstTimerInput,
} from "./lifeCenterMeetingService";
import {
  exportMeetings,
  parseExportFormat,
  parseRangeBoundary,
} from "./lifeCenterMeetingExportService";
import {
  LifeCenterScope,
  isLifeCenterHttpError,
  isMemberScope,
  scopeAllows,
  toDateKey,
} from "./lifeCenterHelpers";
import { assertLifeCenterReachable } from "./lifeCenterAccess";
import { AppError } from "../../utils/custom-error-handlers";

const MAX_TAKE = 500;

const idList = (raw: unknown): number[] =>
  Array.isArray(raw) ? raw.map(Number) : [];

const toPositiveInt = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const ALLOWED_CURRENCIES = ["GHS", "USD", "GBP"];

// Shared, plain validation for the create/update payload — mirrors the
// rules documented in LIFE_CENTER_MEETING_FRONTEND_IMPLEMENTATION_GUIDE.md.
const validateMeetingPayload = (body: any): string | null => {
  const currency = body?.currency || "GHS";
  if (!ALLOWED_CURRENCIES.includes(currency)) {
    return `currency must be one of ${ALLOWED_CURRENCIES.join(", ")}`;
  }

  const offeringAmount = Number(body?.offeringAmount ?? 0);
  if (!Number.isFinite(offeringAmount) || offeringAmount < 0) {
    return "offeringAmount must be a non-negative number";
  }

  const date = new Date(body?.date);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
    return "date must be a valid date that is not in the future";
  }

  return null;
};

const mapAttendee = (row: any) => ({
  soulWonId: row.soulWonId,
  name: [row.soulWon?.first_name, row.soulWon?.last_name]
    .filter(Boolean)
    .join(" "),
  isFirstTimer: row.isFirstTimer,
  phone: {
    number: row.soulWon?.contact_number ?? null,
    country_code: row.soulWon?.country_code ?? null,
  },
  gender: row.soulWon?.gender ?? null,
});

const mapMeeting = (meeting: any) => ({
  id: meeting.id,
  lifeCenterId: meeting.lifeCenterId,
  date: meeting.date,
  day: toDateKey(meeting.date),
  offeringAmount: meeting.offeringAmount,
  currency: meeting.currency,
  note: meeting.note,
  createdById: meeting.createdById,
  createdAt: meeting.createdAt,
  created_by: meeting.createdBy
    ? { id: meeting.createdBy.id, name: meeting.createdBy.name }
    : null,
  attendees: (meeting.attendees ?? []).map(mapAttendee),
});

const sendError = (res: Response, error: any, fallbackStatus: number, message: string) => {
  if (isLifeCenterHttpError(error) || error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return res.status(fallbackStatus).json({ message, error: error?.message });
};

const scopeOf = (req: Request): LifeCenterScope => (req as any).lifeCenterScope;

const parseNewFirstTimers = (raw: unknown): NewFirstTimerInput[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: any) => {
    const dateWon = entry?.date_won ? new Date(entry.date_won) : undefined;
    const wonById = Number(entry?.wonById);
    return {
      title: entry?.title || undefined,
      first_name: String(entry?.first_name ?? "").trim(),
      last_name: String(entry?.last_name ?? "").trim(),
      other_name: entry?.other_name || undefined,
      gender: entry?.gender || undefined,
      contact_number: String(entry?.contact_number ?? "").trim(),
      country_code: entry?.country_code || undefined,
      contact_email: entry?.contact_email || undefined,
      country: entry?.country ?? undefined,
      city: entry?.city || undefined,
      date_won:
        dateWon && !Number.isNaN(dateWon.getTime()) ? dateWon : undefined,
      wonById: Number.isInteger(wonById) && wonById > 0 ? wonById : undefined,
    };
  });
};

const validateNewFirstTimers = (list: NewFirstTimerInput[]): string | null => {
  const missing = list.some(
    (entry) => !entry.first_name || !entry.last_name || !entry.contact_number,
  );
  return missing
    ? "Each new first-timer needs first_name, last_name and contact_number"
    : null;
};

export class LifeCenterMeetingController {
  async createMeeting(req: Request, res: Response) {
    try {
      const lifeCenterId = toPositiveInt(req.body?.lifeCenterId);
      if (!lifeCenterId) {
        return res.status(400).json({ message: "lifeCenterId is required" });
      }

      const validationError = validateMeetingPayload(req.body);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      if (!scopeAllows(scopeOf(req), lifeCenterId)) {
        return res
          .status(401)
          .json({ message: "Not authorized to manage this life center" });
      }
      await assertLifeCenterReachable(req, lifeCenterId);

      const newFirstTimers = parseNewFirstTimers(req.body?.newFirstTimers);
      const firstTimerError = validateNewFirstTimers(newFirstTimers);
      if (firstTimerError) {
        return res.status(400).json({ message: firstTimerError });
      }

      const createdById = Number((req as any).user?.id);

      const meeting = await lifeCenterMeetingService.createMeeting({
        lifeCenterId,
        date: new Date(req.body?.date),
        offeringAmount: String(req.body?.offeringAmount ?? "0"),
        currency: req.body?.currency || "GHS",
        note: req.body?.note ?? null,
        createdById,
        attendeeSoulWonIds: idList(req.body?.attendeeSoulWonIds),
        firstTimerSoulWonIds: idList(req.body?.firstTimerSoulWonIds),
        newFirstTimers,
      });

      return res
        .status(201)
        .json({ message: "Meeting created", data: mapMeeting(meeting) });
    } catch (error: any) {
      return sendError(res, error, 400, "Unable to create meeting");
    }
  }

  async updateMeeting(req: Request, res: Response) {
    try {
      const id = toPositiveInt(req.body?.id);
      const lifeCenterId = toPositiveInt(req.body?.lifeCenterId);
      if (!id || !lifeCenterId) {
        return res
          .status(400)
          .json({ message: "id and lifeCenterId are required" });
      }

      const validationError = validateMeetingPayload(req.body);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const existing = await lifeCenterMeetingService.getMeetingById(id);
      if (!existing) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      // Anyone whose scope covers both the meeting's center and the target
      // center may edit it, not only the creator.
      const scope = scopeOf(req);
      if (
        !scopeAllows(scope, existing.lifeCenterId) ||
        !scopeAllows(scope, lifeCenterId)
      ) {
        return res
          .status(401)
          .json({ message: "Not authorized to modify this meeting" });
      }
      await assertLifeCenterReachable(req, existing.lifeCenterId);
      if (lifeCenterId !== existing.lifeCenterId) {
        await assertLifeCenterReachable(req, lifeCenterId);
      }

      const newFirstTimers = parseNewFirstTimers(req.body?.newFirstTimers);
      const firstTimerError = validateNewFirstTimers(newFirstTimers);
      if (firstTimerError) {
        return res.status(400).json({ message: firstTimerError });
      }

      const currentUserId = Number((req as any).user?.id);

      const meeting = await lifeCenterMeetingService.updateMeeting(
        id,
        {
          lifeCenterId,
          date: new Date(req.body?.date),
          offeringAmount: String(req.body?.offeringAmount ?? "0"),
          currency: req.body?.currency || "GHS",
          note: req.body?.note ?? null,
          attendeeSoulWonIds: idList(req.body?.attendeeSoulWonIds),
          firstTimerSoulWonIds: idList(req.body?.firstTimerSoulWonIds),
          newFirstTimers,
        },
        currentUserId,
      );

      return res
        .status(200)
        .json({ message: "Meeting updated", data: mapMeeting(meeting) });
    } catch (error: any) {
      return sendError(res, error, 400, "Unable to update meeting");
    }
  }

  async deleteMeeting(req: Request, res: Response) {
    try {
      const id = toPositiveInt(req.query?.id);
      if (!id) {
        return res.status(400).json({ message: "id is required" });
      }

      const existing = await lifeCenterMeetingService.getMeetingById(id);
      if (!existing) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      if (!scopeAllows(scopeOf(req), existing.lifeCenterId)) {
        return res
          .status(401)
          .json({ message: "Not authorized to delete this meeting" });
      }
      await assertLifeCenterReachable(req, existing.lifeCenterId);

      await lifeCenterMeetingService.deleteMeeting(id);
      return res.status(200).json({ message: "Meeting deleted" });
    } catch (error: any) {
      return sendError(res, error, 400, "Unable to delete meeting");
    }
  }

  async getMeeting(req: Request, res: Response) {
    try {
      const id = toPositiveInt(req.query?.id);
      if (!id) {
        return res.status(400).json({ message: "id is required" });
      }

      const meeting = await lifeCenterMeetingService.getMeetingById(id);
      if (!meeting) {
        return res.status(404).json({ message: "Meeting not found" });
      }

      if (!scopeAllows(scopeOf(req), meeting.lifeCenterId)) {
        return res
          .status(401)
          .json({ message: "Not authorized to view this meeting" });
      }
      await assertLifeCenterReachable(req, meeting.lifeCenterId);

      return res.status(200).json({ message: "OK", data: mapMeeting(meeting) });
    } catch (error: any) {
      return sendError(res, error, 500, "Error fetching meeting");
    }
  }

  async getMeetings(req: Request, res: Response) {
    try {
      const lifeCenterId = toPositiveInt(req.query?.lifeCenterId);
      const page = toPositiveInt(req.query?.page) ?? 1;
      const take = Math.min(toPositiveInt(req.query?.take) ?? 10, MAX_TAKE);
      const scope = scopeOf(req);
      if (lifeCenterId && !scopeAllows(scope, lifeCenterId)) {
        return res
          .status(401)
          .json({ message: "Not authorized to view this life center's data" });
      }
      if (lifeCenterId) await assertLifeCenterReachable(req, lifeCenterId);

      const { total, meetings } = await lifeCenterMeetingService.getMeetings({
        lifeCenterId,
        lifeCenterIds: isMemberScope(scope) ? scope!.lifeCenterIds : undefined,
        branchId: req.query?.branch_id,
        skip: (page - 1) * take,
        take,
      });

      return res.status(200).json({
        message: "OK",
        current_page: page,
        page_size: take,
        total,
        totalPages: Math.ceil(total / take),
        data: meetings.map(mapMeeting),
      });
    } catch (error: any) {
      return sendError(res, error, 500, "Error fetching meetings");
    }
  }

  async exportMeetings(req: Request, res: Response) {
    try {
      const lifeCenterId = toPositiveInt(req.query?.lifeCenterId);
      if (!lifeCenterId) {
        return res.status(400).json({ message: "lifeCenterId is required" });
      }

      const lifeCenterScope = (req as any).lifeCenterScope;
      if (
        lifeCenterScope?.mode === "member" &&
        Array.isArray(lifeCenterScope?.lifeCenterIds) &&
        !lifeCenterScope.lifeCenterIds.includes(lifeCenterId)
      ) {
        return res
          .status(401)
          .json({ message: "Not authorized to view this life center's data" });
      }
      await assertLifeCenterReachable(req, lifeCenterId);

      const file = await exportMeetings({
        lifeCenterId,
        from: parseRangeBoundary(req.query?.from, "from"),
        to: parseRangeBoundary(req.query?.to, "to"),
        format: parseExportFormat(req.query?.format),
      });

      res.setHeader("Content-Type", file.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.fileName}"`,
      );
      // Without this the browser's XHR layer hides the header, so the client
      // cannot read the filename the server chose.
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      return res.status(200).send(file.buffer);
    } catch (error: any) {
      const status = error?.statusCode ?? error?.status ?? 400;
      return res.status(status).json({
        message: error?.message || "Unable to export meetings",
      });
    }
  }

  async getEligibleFirstTimers(req: Request, res: Response) {
    try {
      const lifeCenterId = toPositiveInt(req.query?.lifeCenterId);
      if (!lifeCenterId) {
        return res.status(400).json({ message: "lifeCenterId is required" });
      }

      const lifeCenterScope = (req as any).lifeCenterScope;
      if (
        lifeCenterScope?.mode === "member" &&
        Array.isArray(lifeCenterScope?.lifeCenterIds) &&
        !lifeCenterScope.lifeCenterIds.includes(lifeCenterId)
      ) {
        return res
          .status(401)
          .json({ message: "Not authorized to view this life center's data" });
      }
      await assertLifeCenterReachable(req, lifeCenterId);

      const souls = await lifeCenterMeetingService.getEligibleFirstTimers(
        lifeCenterId,
      );
      return res.status(200).json({ message: "OK", data: souls });
    } catch (error: any) {
      return sendError(res, error, 500, "Error fetching eligible first-timers");
    }
  }
}
