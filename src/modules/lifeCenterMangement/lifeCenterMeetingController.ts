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
  offeringAmount: meeting.offeringAmount,
  currency: meeting.currency,
  note: meeting.note,
  createdById: meeting.createdById,
  createdAt: meeting.createdAt,
  attendees: (meeting.attendees ?? []).map(mapAttendee),
});

const parseNewFirstTimers = (raw: unknown): NewFirstTimerInput[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: any) => ({
    title: entry.title,
    first_name: entry.first_name,
    last_name: entry.last_name,
    other_name: entry.other_name,
    contact_number: entry.contact_number,
    country_code: entry.country_code,
    contact_email: entry.contact_email,
    country: entry.country,
    city: entry.city,
    date_won: new Date(entry.date_won),
    wonById: Number(entry.wonById),
  }));
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

      const createdById = Number((req as any).user?.id);

      const meeting = await lifeCenterMeetingService.createMeeting({
        lifeCenterId,
        date: new Date(req.body?.date),
        offeringAmount: String(req.body?.offeringAmount ?? "0"),
        currency: req.body?.currency || "GHS",
        note: req.body?.note ?? null,
        createdById,
        attendeeSoulWonIds: (req.body?.attendeeSoulWonIds ?? []).map(Number),
        firstTimerSoulWonIds: (req.body?.firstTimerSoulWonIds ?? []).map(Number),
        newFirstTimers: parseNewFirstTimers(req.body?.newFirstTimers),
      });

      return res
        .status(201)
        .json({ message: "Meeting created", data: mapMeeting(meeting) });
    } catch (error: any) {
      return res
        .status(400)
        .json({ message: "Unable to create meeting", error: error.message });
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

      const currentUserId = Number((req as any).user?.id);
      const isPrivileged = (req as any).user?.user_category === "admin";
      if (!isPrivileged && existing.createdById !== currentUserId) {
        return res
          .status(401)
          .json({ message: "Not authorized to modify this meeting" });
      }

      const meeting = await lifeCenterMeetingService.updateMeeting(
        id,
        {
          lifeCenterId,
          date: new Date(req.body?.date),
          offeringAmount: String(req.body?.offeringAmount ?? "0"),
          currency: req.body?.currency || "GHS",
          note: req.body?.note ?? null,
          attendeeSoulWonIds: (req.body?.attendeeSoulWonIds ?? []).map(Number),
          firstTimerSoulWonIds: (req.body?.firstTimerSoulWonIds ?? []).map(
            Number,
          ),
          newFirstTimers: parseNewFirstTimers(req.body?.newFirstTimers),
        },
        currentUserId,
      );

      return res
        .status(200)
        .json({ message: "Meeting updated", data: mapMeeting(meeting) });
    } catch (error: any) {
      return res
        .status(400)
        .json({ message: "Unable to update meeting", error: error.message });
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

      const currentUserId = Number((req as any).user?.id);
      const isPrivileged = (req as any).user?.user_category === "admin";
      if (!isPrivileged && existing.createdById !== currentUserId) {
        return res
          .status(401)
          .json({ message: "Not authorized to delete this meeting" });
      }

      await lifeCenterMeetingService.deleteMeeting(id);
      return res.status(200).json({ message: "Meeting deleted" });
    } catch (error: any) {
      return res
        .status(400)
        .json({ message: "Unable to delete meeting", error: error.message });
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

      const currentUserId = Number((req as any).user?.id);
      const isPrivileged = (req as any).user?.user_category === "admin";
      if (!isPrivileged && meeting.createdById !== currentUserId) {
        return res
          .status(401)
          .json({ message: "Not authorized to view this meeting" });
      }

      return res.status(200).json({ message: "OK", data: mapMeeting(meeting) });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching meeting", error: error.message });
    }
  }

  async getMeetings(req: Request, res: Response) {
    try {
      const lifeCenterId = toPositiveInt(req.query?.lifeCenterId);
      const page = toPositiveInt(req.query?.page) ?? 1;
      const take = toPositiveInt(req.query?.take) ?? 10;
      const createdById = Number((req as any).user?.id);

      const { total, meetings } = await lifeCenterMeetingService.getMeetings({
        lifeCenterId,
        createdById,
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
      return res
        .status(500)
        .json({ message: "Error fetching meetings", error: error.message });
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

      const file = await exportMeetings({
        lifeCenterId,
        createdById: Number((req as any).user?.id),
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

      const souls = await lifeCenterMeetingService.getEligibleFirstTimers(
        lifeCenterId,
      );
      return res.status(200).json({ message: "OK", data: souls });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching eligible first-timers",
        error: error.message,
      });
    }
  }
}
