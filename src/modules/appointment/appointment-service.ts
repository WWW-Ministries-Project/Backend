import { Prisma, appointment_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import {
  ALL_APPOINTMENT_STATUSES,
  RELEASED_STATUSES,
  appendHistory,
  bookingRuleViolation,
  churchTodayIso,
  formatSlotLabel,
  isoDay,
  parseIsoDay,
  readHistory,
  slotInstant,
} from "./appointment-rules";
import {
  AppointmentSettings,
  AppointmentSettingsService,
} from "./appointment-settings";
import {
  NotifiableBooking,
  notifyAppointmentEvent,
} from "./appointment-notifications";

const availabilityInclude = {
  sessions: true,
  user: {
    select: {
      id: true,
      name: true,
      position: {
        select: {
          name: true,
          category: true,
        },
      },
    },
  },
} as const;

const appointmentInclude = {
  user: {
    select: {
      id: true,
      name: true,
      position: {
        select: {
          name: true,
        },
      },
    },
  },
} as const;

const WEEK_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

type RequesterDetails = {
  id: number;
  name: string;
  email: string | null;
  position: string | null;
};

type AppointmentScope = {
  mode?: "all" | "own";
  userId?: number;
  excludedAttendeeIds?: number[];
};

function normalizeWeekDay(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!WEEK_DAYS.includes(normalized)) {
    throw new Error(
      "day must be one of sunday, monday, tuesday, wednesday, thursday, friday, saturday",
    );
  }
  return normalized;
}

function parseDateInput(dateValue?: string) {
  if (!dateValue) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();

    return {
      dayStart: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
      dayEnd: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
      dayName: WEEK_DAYS[new Date(Date.UTC(y, m, d)).getUTCDay()],
      appointmentDate: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
    };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) {
    throw new Error("date must be in YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    throw new Error("date is invalid");
  }

  return {
    dayStart: new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0)),
    dayEnd: new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999)),
    dayName: WEEK_DAYS[date.getUTCDay()],
    appointmentDate: date,
  };
}

function resolvestaffId(payload: any) {
  const staffId = Number(
    payload.userId ??
      payload.staffId ??
      payload.attendeeId ??
      payload.attendee_id,
  );
  if (!Number.isInteger(staffId) || staffId <= 0) {
    throw new Error("staffId (or userId/attendeeId) must be a valid number");
  }
  return staffId;
}

function resolveRequesterId(payload: any, required = false) {
  const raw = payload.requesterId ?? payload.requestedBy;
  if (raw === undefined || raw === null || raw === "") {
    if (required) {
      throw new Error("requesterId is required");
    }
    return undefined;
  }

  const requesterId = Number(raw);
  if (!Number.isInteger(requesterId) || requesterId <= 0) {
    throw new Error("requesterId must be a valid number");
  }

  return requesterId;
}

function firstValidString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function hasSessionInput(payload: any) {
  return (
    payload?.session !== undefined ||
    payload?.start !== undefined ||
    payload?.startTime !== undefined ||
    payload?.start_time !== undefined ||
    payload?.from !== undefined ||
    payload?.end !== undefined ||
    payload?.endTime !== undefined ||
    payload?.end_time !== undefined ||
    payload?.to !== undefined
  );
}

function resolveSession(payload: any) {
  const start = firstValidString(
    payload?.session?.start,
    payload?.session?.startTime,
    payload?.session?.start_time,
    payload?.session?.from,
    payload?.start,
    payload?.startTime,
    payload?.start_time,
    payload?.from,
  );

  const end = firstValidString(
    payload?.session?.end,
    payload?.session?.endTime,
    payload?.session?.end_time,
    payload?.session?.to,
    payload?.end,
    payload?.endTime,
    payload?.end_time,
    payload?.to,
  );

  if (!start || !end) {
    throw new Error("session with valid start and end is required");
  }

  return {
    start,
    end,
  };
}

function formatDateUTC(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNextDateWindowForDay(day: string) {
  const targetDay = normalizeWeekDay(day);
  const today = parseDateInput();
  const todayIndex = WEEK_DAYS.indexOf(today.dayName);
  const targetIndex = WEEK_DAYS.indexOf(targetDay);
  const offset = (targetIndex - todayIndex + 7) % 7;

  const targetDate = new Date(
    Date.UTC(
      today.appointmentDate.getUTCFullYear(),
      today.appointmentDate.getUTCMonth(),
      today.appointmentDate.getUTCDate() + offset,
      0,
      0,
      0,
      0,
    ),
  );

  return parseDateInput(formatDateUTC(targetDate));
}

function normalizeStatus(value: string) {
  const parsed = value.toUpperCase();
  if (!["PENDING", "CONFIRMED", "CANCELLED"].includes(parsed)) {
    throw new Error("status must be PENDING, CONFIRMED, or CANCELLED");
  }
  return parsed as appointment_status;
}

// Filters (GET /bookings?status=) accept every status; writes through
// PUT /bookings/:id and PUT /status stay limited by normalizeStatus.
function normalizeStatusFilter(value: string) {
  const parsed = value.toUpperCase() as appointment_status;
  if (!ALL_APPOINTMENT_STATUSES.includes(parsed)) {
    throw new Error(
      `status must be one of ${ALL_APPOINTMENT_STATUSES.join(", ")}`,
    );
  }
  return parsed;
}

const toIsoOrNull = (value: Date | null | undefined) =>
  value instanceof Date ? value.toISOString() : null;

function mapAppointmentOutput(
  appointment: any,
  requester: RequesterDetails | null = null,
) {
  return {
    id: appointment.id,
    staffId: appointment.userId,
    attendeeName: appointment.user?.name ?? null,
    position: appointment.user?.position?.name ?? null,
    requester:
      appointment.requesterId !== null && appointment.requesterId !== undefined
        ? {
            id: appointment.requesterId,
            requesterId: appointment.requesterId,
            name: requester?.name ?? null,
            fullName: requester?.name ?? null,
            email: requester?.email ?? null,
            position: requester?.position ?? null,
          }
        : null,
    requesterId: appointment.requesterId ?? null,
    // backward compatible fields
    fullName: appointment.fullName,
    email: appointment.email,
    phone: appointment.phone,
    purpose: appointment.purpose,
    note: appointment.note ?? "",
    date: formatDateUTC(appointment.date),
    session: {
      start: appointment.startTime,
      end: appointment.endTime,
    },
    status: appointment.status,
    createdAt: appointment.createdAt,
    // Appointments redesign (additive)
    reasonId: appointment.reasonId ?? null,
    respondedAt: toIsoOrNull(appointment.respondedAt),
    proposedDate:
      appointment.proposedDate instanceof Date
        ? formatDateUTC(appointment.proposedDate)
        : null,
    proposedStartTime: appointment.proposedStartTime ?? null,
    proposedEndTime: appointment.proposedEndTime ?? null,
    declineReason: appointment.declineReason ?? null,
    responseMessage: appointment.responseMessage ?? null,
    remindedAt: toIsoOrNull(appointment.remindedAt),
    history: readHistory(appointment.history),
  };
}

async function validateRequesterExists(requesterId: number) {
  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { id: true },
  });

  if (!requester) {
    throw new Error("Requester user not found");
  }
}

async function getRequesterMap(
  requesterIds: Array<number | null | undefined>,
): Promise<Map<number, RequesterDetails>> {
  const uniqueRequesterIds = Array.from(
    new Set(
      requesterIds.filter(
        (id): id is number => Number.isInteger(id) && Number(id) > 0,
      ),
    ),
  );

  if (uniqueRequesterIds.length === 0) {
    return new Map();
  }

  const requesters = await prisma.user.findMany({
    where: {
      id: {
        in: uniqueRequesterIds,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      position: {
        select: {
          name: true,
        },
      },
    },
  });

  return new Map(
    requesters.map((requester) => [
      requester.id,
      {
        id: requester.id,
        name: requester.name,
        email: requester.email ?? null,
        position: requester.position?.name ?? null,
      },
    ]),
  );
}

async function mapAppointmentsOutput(appointments: any[]) {
  const requesterMap = await getRequesterMap(
    appointments.map((appointment) => appointment.requesterId),
  );

  return appointments.map((appointment) =>
    mapAppointmentOutput(
      appointment,
      requesterMap.get(appointment.requesterId) ?? null,
    ),
  );
}

async function mapAppointmentWithRequester(appointment: any) {
  const requesterMap = await getRequesterMap([appointment.requesterId]);
  return mapAppointmentOutput(
    appointment,
    requesterMap.get(appointment.requesterId) ?? null,
  );
}

function mapAvailabilityPayload(records: any[]) {
  const grouped = new Map<
    number,
    {
      userId: string;
      fullName: string | null;
      position: string | null;
      slotLimits: number[];
      timeSlots: Array<{
        day: string;
        startTime: string;
        endTime: string;
        sessionDurationMinutes: number;
        sessions: Array<{ start: string; end: string }>;
      }>;
    }
  >();

  for (const availability of records) {
    if (!grouped.has(availability.userId)) {
      grouped.set(availability.userId, {
        userId: String(availability.userId),
        fullName: availability.user?.name ?? null,
        position: availability.user?.position?.name ?? null,
        slotLimits: [],
        timeSlots: [],
      });
    }

    const entry = grouped.get(availability.userId)!;
    const slotLimit = Number(availability.maxBookingsPerSlot);
    entry.slotLimits.push(
      Number.isInteger(slotLimit) && slotLimit > 0 ? slotLimit : 1,
    );
    entry.timeSlots.push({
      day: String(availability.day).toLowerCase(),
      startTime: availability.startTime,
      endTime: availability.endTime,
      sessionDurationMinutes: availability.sessionDurationMinutes,
      sessions: [...availability.sessions]
        .map((session: any) => ({
          start: session.start,
          end: session.end,
        }))
        .sort((a, b) => a.start.localeCompare(b.start)),
    });
  }

  return Array.from(grouped.values()).map((entry) => {
    const resolvedMaxBookingsPerSlot =
      entry.slotLimits.length > 0 ? Math.min(...entry.slotLimits) : 1;

    return {
      userId: entry.userId,
      fullName: entry.fullName,
      position: entry.position,
      maxBookingsPerSlot: resolvedMaxBookingsPerSlot,
      timeSlots: entry.timeSlots.sort((a, b) => {
        const dayDiff = WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day);
        if (dayDiff !== 0) {
          return dayDiff;
        }
        return a.startTime.localeCompare(b.startTime);
      }),
    };
  });
}

type StaffExtras = {
  bufferMinutes: number;
  paused: boolean;
  timeOff: Array<{ id: number; from: string; to: string; note: string | null }>;
};

const EMPTY_STAFF_EXTRAS: StaffExtras = { bufferMinutes: 0, paused: false, timeOff: [] };

const mapTimeOff = (row: {
  id: number;
  user_id: number;
  from_date: Date;
  to_date: Date;
  note: string | null;
}) => ({
  id: row.id,
  userId: row.user_id,
  from: isoDay(row.from_date),
  to: isoDay(row.to_date),
  note: row.note ?? null,
});

/**
 * Break, pause switch and current/upcoming time off (entries ending today or
 * later) for each person.
 */
async function loadStaffExtras(
  db: Prisma.TransactionClient | typeof prisma,
  userIds: number[],
  now: Date = new Date(),
): Promise<Map<number, StaffExtras>> {
  const ids = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  const map = new Map<number, StaffExtras>();
  if (!ids.length) return map;

  const today = parseIsoDay(churchTodayIso(now))!;
  const [profiles, timeOff] = await Promise.all([
    db.appointment_staff_profile.findMany({ where: { user_id: { in: ids } } }),
    db.appointment_time_off.findMany({
      where: { user_id: { in: ids }, to_date: { gte: today } },
      orderBy: [{ from_date: "asc" }, { id: "asc" }],
    }),
  ]);

  for (const id of ids) {
    map.set(id, { bufferMinutes: 0, paused: false, timeOff: [] });
  }
  for (const profile of profiles) {
    const entry = map.get(profile.user_id)!;
    entry.bufferMinutes = profile.buffer_minutes;
    entry.paused = profile.paused;
  }
  for (const row of timeOff) {
    const { userId: _userId, ...entry } = mapTimeOff(row);
    map.get(row.user_id)!.timeOff.push(entry);
  }
  return map;
}

async function withStaffExtras<T extends { userId: string }>(entries: T[]) {
  const extras = await loadStaffExtras(
    prisma,
    entries.map((entry) => Number(entry.userId)),
  );
  return entries.map((entry) => ({
    ...entry,
    ...(extras.get(Number(entry.userId)) ?? EMPTY_STAFF_EXTRAS),
  }));
}

/**
 * Booking rules for a person and slot: paused, time off, minimum notice and
 * the book-ahead limit. Throws a 400 with a toast-ready message.
 */
async function assertBookingRules(
  db: Prisma.TransactionClient,
  params: {
    staffId: number;
    date: string;
    startTime: string;
    settings: AppointmentSettings;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  const [person, extras] = await Promise.all([
    db.user.findUnique({ where: { id: params.staffId }, select: { name: true } }),
    loadStaffExtras(db, [params.staffId], now),
  ]);
  const staff = extras.get(params.staffId) ?? EMPTY_STAFF_EXTRAS;
  const violation = bookingRuleViolation({
    personName: person?.name ?? "",
    paused: staff.paused,
    timeOff: staff.timeOff,
    settings: params.settings,
    date: params.date,
    startTime: params.startTime,
    now,
  });
  if (violation) {
    throw new InputValidationError(violation);
  }
}

/**
 * Bookings that hold a place on a person's day. A RESCHEDULED booking holds
 * its proposed slot (the frontend shows it there); cancelled and declined
 * ones hold nothing.
 */
async function findOccupiedSessions(
  db: Prisma.TransactionClient,
  params: {
    staffId: number;
    dayStart: Date;
    dayEnd: Date;
    excludeAppointmentId?: number;
  },
) {
  const { staffId, dayStart, dayEnd, excludeAppointmentId } = params;
  const rows = await db.appointment.findMany({
    where: {
      userId: staffId,
      status: { notIn: RELEASED_STATUSES },
      OR: [
        { status: { not: "RESCHEDULED" }, date: { gte: dayStart, lte: dayEnd } },
        { status: "RESCHEDULED", proposedDate: { gte: dayStart, lte: dayEnd } },
      ],
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: {
      status: true,
      startTime: true,
      endTime: true,
      proposedStartTime: true,
      proposedEndTime: true,
    },
  });

  return rows.map((row) =>
    row.status === "RESCHEDULED" && row.proposedStartTime
      ? {
          startTime: row.proposedStartTime,
          endTime: row.proposedEndTime ?? row.proposedStartTime,
        }
      : { startTime: row.startTime, endTime: row.endTime },
  );
}

/**
 * The chosen session was taken (or its block filled up) before this request
 * got to it. The controller answers 409 so clients know to refresh the slot
 * list instead of treating it as a bad payload.
 */
export class SlotUnavailableError extends Error {
  readonly code = "SLOT_UNAVAILABLE";
}

/**
 * Booking validation reads, then writes, so two members tapping the same
 * session at once could both pass the check before either row exists.
 * Locking the staff member's user row first queues concurrent bookings for
 * that person: the second waits for the first to commit, then re-reads and
 * sees the session taken. `user` is non-reserved in MySQL, so no quoting.
 */
async function lockStaffForBooking(
  tx: Prisma.TransactionClient,
  staffId: number,
) {
  await tx.$queryRaw`SELECT id FROM user WHERE id = ${staffId} FOR UPDATE`;
}

async function validateBookingWindow(
  db: Prisma.TransactionClient,
  params: {
    staffId: number;
    date: string;
    session: { start: string; end: string };
    excludeAppointmentId?: number;
  },
) {
  const { staffId, date, session, excludeAppointmentId } = params;
  const { dayStart, dayEnd, dayName, appointmentDate } = parseDateInput(date);

  const availabilityCandidates = await db.availability.findMany({
    where: {
      userId: staffId,
      sessions: {
        some: {
          start: session.start,
          end: session.end,
        },
      },
    },
    include: {
      sessions: true,
    },
  });

  const availabilityForSession = availabilityCandidates.find(
    (availability) => String(availability.day).toLowerCase() === dayName,
  );

  if (!availabilityForSession) {
    throw new Error("Selected session is not available for this user");
  }

  const occupied = await findOccupiedSessions(db, {
    staffId,
    dayStart,
    dayEnd,
    excludeAppointmentId,
  });

  const existingSessionBooking = occupied.some(
    (booking) =>
      booking.startTime === session.start && booking.endTime === session.end,
  );

  if (existingSessionBooking) {
    throw new SlotUnavailableError("This session is already booked");
  }

  const blockSessionKeys = new Set(
    availabilityForSession.sessions.map((s) => `${s.start}|${s.end}`),
  );

  const uniqueBookedSessions = new Set(
    occupied
      .map((booking) => `${booking.startTime}|${booking.endTime}`)
      .filter((key) => blockSessionKeys.has(key)),
  );

  const limit = availabilityForSession.maxBookingsPerSlot || 1;
  if (uniqueBookedSessions.size >= limit) {
    throw new SlotUnavailableError(
      "This availability block has reached its max number of booked sessions",
    );
  }

  return appointmentDate;
}

/** 403 for a signed-in user acting on a booking that isn't theirs. */
export class AppointmentForbiddenError extends Error {
  readonly statusCode = 403;
}

async function assertUserExists(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new NotFoundError("We couldn't find that person.");
  }
}

function statusHistoryLine(
  status: appointment_status,
  byActor: string,
): { text: string; tone: "neutral" | "success" | "warning" } {
  if (status === "CONFIRMED") return { text: `Confirmed${byActor}`, tone: "success" };
  if (status === "CANCELLED") return { text: `Cancelled${byActor}`, tone: "warning" };
  return { text: `Moved back to waiting for a reply${byActor}`, tone: "neutral" };
}

/** Shape the notifier needs from a booking row loaded with appointmentInclude. */
export function toNotifiableBooking(
  appointment: any,
  requesterName?: string | null,
): NotifiableBooking {
  return {
    id: appointment.id,
    userId: appointment.userId,
    requesterId: appointment.requesterId ?? null,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    fullName: appointment.fullName,
    attendeeName: appointment.user?.name ?? "",
    requesterName: requesterName || appointment.fullName || "",
    proposedDate: appointment.proposedDate ?? null,
    proposedStartTime: appointment.proposedStartTime ?? null,
    declineReason: appointment.declineReason ?? null,
    responseMessage: appointment.responseMessage ?? null,
  };
}

export async function getUserName(userId: number | null | undefined) {
  if (!userId) return "";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  return user?.name ?? "";
}

export {
  appointmentInclude,
  assertBookingRules,
  findOccupiedSessions,
  lockStaffForBooking,
  mapAppointmentWithRequester,
  validateBookingWindow,
};

export const AppointmentService = {
  // CREATE APPOINTMENT (With Overbooking Protection)
  // `callerId` is the signed-in user. A caller with manage permission
  // (`options.canManage`) may book for another member (`requesterId`) and
  // confirm straight away (`status: "CONFIRMED"`).
  async createAppointment(
    payload: any,
    callerId: number,
    options: { canManage?: boolean } = {},
  ) {
    const staffId = resolvestaffId(payload);
    if (!Number.isInteger(callerId) || callerId <= 0) {
      throw new Error("requesterId must be a valid number");
    }

    const requestedFor = resolveRequesterId(payload);
    const requesterId = requestedFor ?? callerId;
    if (requesterId !== callerId && !options.canManage) {
      throw new InputValidationError("You can only book appointments for yourself.");
    }

    const rawStatus =
      payload?.status === undefined || payload?.status === null || payload?.status === ""
        ? "PENDING"
        : String(payload.status).toUpperCase();
    if (rawStatus !== "PENDING" && rawStatus !== "CONFIRMED") {
      throw new InputValidationError("A new booking can only start as PENDING or CONFIRMED.");
    }
    if (rawStatus === "CONFIRMED" && !options.canManage) {
      throw new InputValidationError(
        "Only appointment managers can confirm a booking straight away.",
      );
    }
    const status = rawStatus as appointment_status;

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        id: true,
        name: true,
        email: true,
        user_info: { select: { primary_number: true, country_code: true } },
      },
    });
    if (!requester) {
      throw new Error("Requester user not found");
    }

    let reasonId: number | null = null;
    let reasonLabel: string | undefined;
    if (payload?.reasonId !== undefined && payload?.reasonId !== null && payload?.reasonId !== "") {
      reasonId = Number(payload.reasonId);
      if (!Number.isInteger(reasonId) || reasonId <= 0) {
        throw new InputValidationError("That reason isn't valid. Choose one from the list.");
      }
      const reason = await prisma.appointment_reason.findUnique({
        where: { id: reasonId },
        select: { label: true },
      });
      if (!reason) {
        throw new InputValidationError("That reason is no longer available. Choose another one.");
      }
      reasonLabel = reason.label;
    }

    const fullName = firstValidString(payload?.fullName, requester.name);
    const email = firstValidString(payload?.email, requester.email) ?? "";
    const phone =
      firstValidString(payload?.phone, requester.user_info?.primary_number) ?? "";
    const purpose = firstValidString(payload?.purpose, reasonLabel);
    if (!fullName) {
      throw new InputValidationError("Add the name of the person booking.");
    }
    if (!purpose) {
      throw new InputValidationError("Choose a reason for the appointment.");
    }

    const session = resolveSession(payload);

    if (!payload?.date || typeof payload.date !== "string") {
      throw new Error("date is required in YYYY-MM-DD format");
    }

    const branchId = await resolveBranchIdOrDefault(payload?.branch_id);
    const settings = await AppointmentSettingsService.get();
    const now = new Date();

    const callerName =
      callerId === requesterId ? requester.name : await getUserName(callerId);
    const historyText =
      callerId === requesterId
        ? `Requested by ${requester.name} in the app`
        : status === "CONFIRMED"
          ? `Booked by ${callerName} for ${requester.name} and confirmed`
          : `Booked by ${callerName} for ${requester.name}`;

    const created = await prisma.$transaction(async (tx) => {
      await lockStaffForBooking(tx, staffId);
      const appointmentDate = await validateBookingWindow(tx, {
        staffId,
        date: payload.date,
        session,
      });
      await assertBookingRules(tx, {
        staffId,
        date: payload.date,
        startTime: session.start,
        settings,
        now,
      });

      return tx.appointment.create({
        data: {
          fullName,
          email,
          phone,
          purpose,
          note: payload?.note || "",
          date: appointmentDate,
          startTime: session.start,
          endTime: session.end,
          userId: staffId,
          requesterId,
          branch_id: branchId,
          status,
          reasonId,
          ...(status === "CONFIRMED" ? { respondedAt: now, acceptedAt: now } : {}),
          history: appendHistory(
            [],
            historyText,
            status === "CONFIRMED" ? "success" : callerId === requesterId ? "neutral" : "info",
            now,
          ) as unknown as Prisma.InputJsonValue,
        },
        include: appointmentInclude,
      });
    });

    const notifiable = toNotifiableBooking(created, requester.name);
    if (status === "CONFIRMED") {
      // Both sides hear about it: the person booked through their "new"
      // channels, the member through their "accepted" channels.
      await notifyAppointmentEvent({
        event: "accepted",
        matrixEvent: "new",
        audiences: ["attendee"],
        booking: notifiable,
        settings,
        actorId: callerId,
      });
      await notifyAppointmentEvent({
        event: "accepted",
        audiences: ["requester", "admins"],
        booking: notifiable,
        settings,
        actorId: callerId,
      });
    } else {
      await notifyAppointmentEvent({
        event: "new",
        booking: notifiable,
        settings,
        actorId: callerId,
        // The member's own "request sent" receipt (new → requester).
        notifyActor: callerId === requesterId,
      });
    }

    return mapAppointmentWithRequester(created);
  },

  // SET AVAILABILITY
  async saveStaffAvailability(payload: any) {
    const { userId, maxBookingsPerSlot, timeSlots } = payload;
    const parsedUserId = Number(userId);
    const parsedMaxBookings = Number(maxBookingsPerSlot);

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new Error("userId must be a valid positive number");
    }
    if (!Number.isInteger(parsedMaxBookings) || parsedMaxBookings <= 0) {
      throw new Error("maxBookingsPerSlot must be a valid positive number");
    }
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
      throw new Error("timeSlots must be a non-empty array");
    }

    // Break between sessions (redesign). Sessions arrive already spaced by
    // the client; this is stored so the editor can show it again.
    let bufferMinutes: number | undefined;
    if (payload.bufferMinutes !== undefined && payload.bufferMinutes !== null) {
      bufferMinutes = Number(payload.bufferMinutes);
      if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) {
        throw new Error("bufferMinutes must be a whole number of minutes from 0 to 240");
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      if (bufferMinutes !== undefined) {
        await tx.appointment_staff_profile.upsert({
          where: { user_id: parsedUserId },
          create: { user_id: parsedUserId, buffer_minutes: bufferMinutes },
          update: { buffer_minutes: bufferMinutes },
        });
      }

      // Update the user's max booking limit
      await tx.availability.deleteMany({ where: { userId: parsedUserId } });

      for (const slot of timeSlots) {
        if (
          typeof slot?.startTime !== "string" ||
          !slot.startTime.trim() ||
          typeof slot?.endTime !== "string" ||
          !slot.endTime.trim()
        ) {
          throw new Error("Each time slot must include valid startTime and endTime");
        }
        if (
          !Array.isArray(slot.sessions) ||
          slot.sessions.length === 0 ||
          !Number.isInteger(Number(slot.sessionDurationMinutes)) ||
          Number(slot.sessionDurationMinutes) <= 0
        ) {
          throw new Error(
            "Each time slot must include sessionDurationMinutes and a non-empty sessions array",
          );
        }
        for (const session of slot.sessions) {
          if (
            typeof session?.start !== "string" ||
            !session.start.trim() ||
            typeof session?.end !== "string" ||
            !session.end.trim()
          ) {
            throw new Error("Each session must include valid start and end");
          }
        }

        const day = normalizeWeekDay(String(slot.day ?? ""));
        await tx.availability.create({
          data: {
            userId: parsedUserId,
            day,
            branch_id: await resolveBranchIdOrDefault(payload?.branch_id),
            maxBookingsPerSlot: parsedMaxBookings,
            startTime: slot.startTime.trim(),
            endTime: slot.endTime.trim(),
            sessionDurationMinutes: Number(slot.sessionDurationMinutes),
            sessions: {
              create: slot.sessions.map((s: any) => ({
                start: String(s.start ?? "").trim(),
                end: String(s.end ?? "").trim(),
              })),
            },
          },
        });
      }

      const created = await tx.availability.findMany({
        where: { userId: parsedUserId },
        include: availabilityInclude,
        orderBy: [{ day: "asc" }, { startTime: "asc" }],
      });

      return mapAvailabilityPayload(created)[0] ?? {
        userId: String(parsedUserId),
        maxBookingsPerSlot: parsedMaxBookings,
        timeSlots: [],
      };
    });

    return (await withStaffExtras([saved]))[0];
  },

  // FETCH ALL AVAILABILITY (OPTIONAL STAFF FILTER)
  async getAllAvailability(
    userId?: number,
    scope?: AppointmentScope,
    branchId?: unknown,
  ) {
    const excludedAttendeeIds =
      scope?.mode === "all" ? scope?.excludedAttendeeIds || [] : [];
    const where: any = { ...(getBranchScopedWhere(branchId) || {}) };

    if (scope?.mode === "own" && scope?.userId) {
      where.userId = scope.userId;
    } else if (userId !== undefined) {
      if (excludedAttendeeIds.includes(userId)) {
        return [];
      }
      where.userId = userId;
    } else if (excludedAttendeeIds.length > 0) {
      where.userId = { notIn: excludedAttendeeIds };
    }

    const availability = await prisma.availability.findMany({
      where: Object.keys(where).length ? where : undefined,
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });

    return withStaffExtras(mapAvailabilityPayload(availability));
  },

  // UPDATE AVAILABILITY SLOT
  async updateAvailability(id: number, payload: any) {
    const existing = await prisma.availability.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!existing) {
      throw new Error("Availability not found");
    }

    const updateData: any = {};

    if (payload.userId !== undefined) {
      const parsedUserId = Number(payload.userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
        throw new Error("userId must be a valid positive number");
      }
      updateData.userId = parsedUserId;
    }

    if (payload.branch_id !== undefined) {
      updateData.branch_id = await resolveBranchIdOrDefault(payload.branch_id);
    }

    if (payload.day !== undefined) {
      if (typeof payload.day !== "string" || !payload.day.trim()) {
        throw new Error("day must be a valid string");
      }
      updateData.day = normalizeWeekDay(payload.day);
    }

    let parsedLimit: number | undefined;
    if (payload.maxBookingsPerSlot !== undefined) {
      parsedLimit = Number(payload.maxBookingsPerSlot);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        throw new Error("maxBookingsPerSlot must be a valid positive number");
      }
      updateData.maxBookingsPerSlot = parsedLimit;
    }

    if (payload.startTime !== undefined) {
      if (typeof payload.startTime !== "string" || !payload.startTime.trim()) {
        throw new Error("startTime must be a valid string");
      }
      updateData.startTime = payload.startTime.trim();
    }

    if (payload.endTime !== undefined) {
      if (typeof payload.endTime !== "string" || !payload.endTime.trim()) {
        throw new Error("endTime must be a valid string");
      }
      updateData.endTime = payload.endTime.trim();
    }

    if (payload.sessionDurationMinutes !== undefined) {
      const parsedDuration = Number(payload.sessionDurationMinutes);
      if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
        throw new Error(
          "sessionDurationMinutes must be a valid positive number",
        );
      }
      updateData.sessionDurationMinutes = parsedDuration;
    }

    const hasSessions = payload.sessions !== undefined;
    if (hasSessions) {
      if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
        throw new Error("sessions must be a non-empty array");
      }

      for (const session of payload.sessions) {
        if (
          typeof session?.start !== "string" ||
          !session.start.trim() ||
          typeof session?.end !== "string" ||
          !session.end.trim()
        ) {
          throw new Error(
            "Each session must contain non-empty start and end values",
          );
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedAvailability = await tx.availability.update({
        where: { id },
        data: {
          ...updateData,
          ...(hasSessions
            ? {
                sessions: {
                  deleteMany: {},
                  create: payload.sessions.map((session: any) => ({
                    start: session.start.trim(),
                    end: session.end.trim(),
                  })),
                },
              }
            : {}),
        },
        select: {
          userId: true,
        },
      });

      const targetUserId = updatedAvailability.userId;
      if (parsedLimit !== undefined) {
        await tx.availability.updateMany({
          where: { userId: targetUserId },
          data: { maxBookingsPerSlot: parsedLimit },
        });
      }

      const normalized = await tx.availability.findMany({
        where: { userId: targetUserId },
        include: availabilityInclude,
        orderBy: [{ day: "asc" }, { startTime: "asc" }],
      });

      return mapAvailabilityPayload(normalized)[0] ?? {
        userId: String(targetUserId),
        maxBookingsPerSlot: parsedLimit ?? 1,
        timeSlots: [],
      };
    });

    return (await withStaffExtras([updated]))[0];
  },

  // DELETE AVAILABILITY SLOT
  async deleteAvailability(id: number) {
    const existing = await prisma.availability.findUnique({
      where: { id },
      include: availabilityInclude,
    });

    if (!existing) {
      throw new Error("Availability not found");
    }

    await prisma.availability.delete({ where: { id } });
    return existing;
  },

  // FETCH AVAILABILITY WITH SLOT/SESSION STATUS TAGS (ALL DAYS, OR A SINGLE
  // CALLER-SUPPLIED DATE WHEN filters.date IS GIVEN)
  async getAvailabilityWithSessionStatus(
    scope?: AppointmentScope,
    branchId?: unknown,
    filters?: { date?: string; category?: string },
  ) {
    const excludedAttendeeIds =
      scope?.mode === "all" ? scope?.excludedAttendeeIds || [] : [];
    const availabilityWhere: any = {
      ...(getBranchScopedWhere(branchId) || {}),
    };
    if (scope?.mode === "own" && scope?.userId) {
      availabilityWhere.userId = scope.userId;
    } else if (excludedAttendeeIds.length > 0) {
      availabilityWhere.userId = { notIn: excludedAttendeeIds };
    }

    const category = firstValidString(filters?.category);
    if (category) {
      availabilityWhere.user = { position: { category } };
    }

    // A caller-supplied date pins every slot's status to that exact day
    // instead of each slot's own next matching weekday.
    const requestedDateWindow = filters?.date
      ? parseDateInput(filters.date)
      : undefined;
    if (requestedDateWindow) {
      availabilityWhere.day = requestedDateWindow.dayName;
    }

    const allAvailabilities = await prisma.availability.findMany({
      where: Object.keys(availabilityWhere).length ? availabilityWhere : undefined,
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });

    if (allAvailabilities.length === 0) {
      return [];
    }

    // Paused people take no new bookings, and days on time off are left out
    // (below, once each slot's date is known).
    const staffExtras = await loadStaffExtras(
      prisma,
      allAvailabilities.map((a) => a.userId),
    );
    const isAwayOn = (userId: number, day: string) =>
      (staffExtras.get(userId)?.timeOff ?? []).some(
        (entry) => day >= entry.from && day <= entry.to,
      );
    const bookableAvailabilities = allAvailabilities.filter(
      (a) => !staffExtras.get(a.userId)?.paused,
    );
    if (bookableAvailabilities.length === 0) {
      return [];
    }

    const userIds = Array.from(new Set(bookableAvailabilities.map((a) => a.userId)));
    const availabilityDays = Array.from(
      new Set(
        bookableAvailabilities
          .map((availability) => String(availability.day).toLowerCase())
          .filter((day) => WEEK_DAYS.includes(day)),
      ),
    );

    const dayWindows = new Map<
      string,
      { dayStart: Date; dayEnd: Date; dayName: string }
    >();
    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;

    for (const day of availabilityDays) {
      const dayWindow = requestedDateWindow ?? getNextDateWindowForDay(day);
      dayWindows.set(day, dayWindow);
      if (!rangeStart || dayWindow.dayStart < rangeStart) {
        rangeStart = dayWindow.dayStart;
      }
      if (!rangeEnd || dayWindow.dayEnd > rangeEnd) {
        rangeEnd = dayWindow.dayEnd;
      }
    }

    // A RESCHEDULED booking holds its proposed slot; cancelled and declined
    // ones hold nothing (same rule as validateBookingWindow).
    const appointmentRows =
      rangeStart && rangeEnd
        ? await prisma.appointment.findMany({
            where: {
              userId: { in: userIds },
              status: { notIn: RELEASED_STATUSES },
              OR: [
                {
                  status: { not: "RESCHEDULED" },
                  date: { gte: rangeStart, lte: rangeEnd },
                },
                {
                  status: "RESCHEDULED",
                  proposedDate: { gte: rangeStart, lte: rangeEnd },
                },
              ],
            },
            select: {
              userId: true,
              startTime: true,
              endTime: true,
              date: true,
              status: true,
              proposedDate: true,
              proposedStartTime: true,
              proposedEndTime: true,
            },
          })
        : [];
    const appointments = appointmentRows.map((row) =>
      row.status === "RESCHEDULED" && row.proposedDate && row.proposedStartTime
        ? {
            userId: row.userId,
            date: row.proposedDate,
            startTime: row.proposedStartTime,
            endTime: row.proposedEndTime ?? row.proposedStartTime,
          }
        : {
            userId: row.userId,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
          },
    );

    const appointmentsByUserDay = new Map<
      string,
      Array<{ startTime: string; endTime: string }>
    >();
    const bookedSessionsByUser = new Map<
      number,
      Map<string, { date: string; start: string; end: string }>
    >();

    for (const booking of appointments) {
      const bookingDate = formatDateUTC(booking.date);
      if (!bookedSessionsByUser.has(booking.userId)) {
        bookedSessionsByUser.set(booking.userId, new Map());
      }
      bookedSessionsByUser.get(booking.userId)!.set(
        `${bookingDate}|${booking.startTime}|${booking.endTime}`,
        {
          date: bookingDate,
          start: booking.startTime,
          end: booking.endTime,
        },
      );

      const bookingDay = WEEK_DAYS[booking.date.getUTCDay()];
      if (!dayWindows.has(bookingDay)) {
        continue;
      }
      const key = `${booking.userId}|${bookingDay}`;
      if (!appointmentsByUserDay.has(key)) {
        appointmentsByUserDay.set(key, []);
      }
      appointmentsByUserDay.get(key)!.push({
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
    }

    const grouped = new Map<
      number,
      {
        userId: string;
        fullName: string | null;
        position: string | null;
        category: string | null;
        slotLimits: number[];
        bookedSessions: Array<{
          date: string;
          start: string;
          end: string;
        }>;
        timeSlots: Array<{
          day: string;
          startTime: string;
          endTime: string;
          sessionDurationMinutes: number;
          status: "AVAILABLE" | "BOOKED";
          sessions: Array<{
            start: string;
            end: string;
          }>;
        }>;
      }
    >();

    for (const availability of bookableAvailabilities) {
      const window = dayWindows.get(String(availability.day).toLowerCase());
      if (window && isAwayOn(availability.userId, isoDay(window.dayStart))) {
        continue;
      }
      if (!grouped.has(availability.userId)) {
        const userBookedSessions = Array.from(
          bookedSessionsByUser.get(availability.userId)?.values() ?? [],
        ).sort(
          (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
        );

        grouped.set(availability.userId, {
          userId: String(availability.userId),
          fullName: availability.user?.name ?? null,
          position: availability.user?.position?.name ?? null,
          category: availability.user?.position?.category ?? null,
          slotLimits: [],
          bookedSessions: userBookedSessions,
          timeSlots: [],
        });
      }

      const entry = grouped.get(availability.userId)!;
      const slotLimit = availability.maxBookingsPerSlot || 1;
      entry.slotLimits.push(slotLimit);
      const slotSessionKeys = new Set(
        availability.sessions.map((session) => `${session.start}|${session.end}`),
      );
      const slotDay = String(availability.day).toLowerCase();
      const userDayBookings =
        appointmentsByUserDay.get(`${availability.userId}|${slotDay}`) || [];
      const bookedSessionsInSlot = new Set<string>();

      for (const booking of userDayBookings) {
        const sessionKey = `${booking.startTime}|${booking.endTime}`;
        if (slotSessionKeys.has(sessionKey)) {
          bookedSessionsInSlot.add(sessionKey);
        }
      }

      const slotMaxReached = bookedSessionsInSlot.size >= slotLimit;
      const slotStatus: "AVAILABLE" | "BOOKED" = slotMaxReached
        ? "BOOKED"
        : "AVAILABLE";

      const slotSessions = [...availability.sessions]
        .map((session) => {
          return {
            start: session.start,
            end: session.end,
          };
        })
        .sort((a, b) => a.start.localeCompare(b.start));

      entry.timeSlots.push({
        day: String(availability.day).toLowerCase(),
        startTime: availability.startTime,
        endTime: availability.endTime,
        sessionDurationMinutes: availability.sessionDurationMinutes,
        status: slotStatus,
        sessions: slotSessions,
      });
    }

    return Array.from(grouped.values()).map((entry) => {
      const resolvedMaxBookingsPerSlot =
        entry.slotLimits.length > 0 ? Math.min(...entry.slotLimits) : 1;
      return {
        userId: entry.userId,
        fullName: entry.fullName,
        position: entry.position,
        category: entry.category,
        maxBookingsPerSlot: resolvedMaxBookingsPerSlot,
        bookedSessions: entry.bookedSessions,
        timeSlots: entry.timeSlots.sort((a, b) => {
          const dayDiff = WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day);
          if (dayDiff !== 0) {
            return dayDiff;
          }
          return a.startTime.localeCompare(b.startTime);
        }),
      };
    });
  },

  // FETCH ALL APPOINTMENT BOOKINGS
  async getAllBookings(
    filters: {
      staffId?: number;
      requesterId?: number;
      email?: string;
      status?: string;
      date?: string;
      branch_id?: unknown;
    },
    scope?: AppointmentScope,
  ) {
    const whereAnd: any[] = [];

    const branchWhere = getBranchScopedWhere(filters.branch_id);
    if (branchWhere) {
      whereAnd.push(branchWhere);
    }

    if (filters.staffId !== undefined) {
      whereAnd.push({ userId: filters.staffId });
    }

    if (filters.requesterId !== undefined) {
      whereAnd.push({ requesterId: filters.requesterId });
    }

    if (filters.email) {
      whereAnd.push({ email: filters.email.trim() });
    }

    if (filters.status) {
      whereAnd.push({ status: normalizeStatusFilter(filters.status) });
    }

    if (filters.date) {
      const { dayStart, dayEnd } = parseDateInput(filters.date);
      whereAnd.push({
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
      });
    }

    if (scope?.mode === "own" && scope?.userId) {
      whereAnd.push({
        OR: [{ requesterId: scope.userId }, { userId: scope.userId }],
      });
    } else if (
      scope?.mode === "all" &&
      Array.isArray(scope?.excludedAttendeeIds) &&
      scope.excludedAttendeeIds.length > 0
    ) {
      whereAnd.push({
        userId: {
          notIn: scope.excludedAttendeeIds,
        },
      });
    }

    const where = whereAnd.length > 0 ? { AND: whereAnd } : undefined;

    const bookings = await prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return mapAppointmentsOutput(bookings);
  },

  // FETCH APPOINTMENT BOOKING BY ID
  async getBookingById(id: number) {
    const booking = await prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });

    if (!booking) {
      throw new Error("Appointment not found");
    }

    return mapAppointmentWithRequester(booking);
  },

  // UPDATE APPOINTMENT BOOKING
  async updateBooking(id: number, payload: any, actorId?: number) {
    const existing = await prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });

    if (!existing) {
      throw new Error("Appointment not found");
    }

    const nextstaffId =
      payload.userId !== undefined ||
      payload.staffId !== undefined ||
      payload.attendeeId !== undefined ||
      payload.attendee_id !== undefined
        ? resolvestaffId(payload)
        : existing.userId;
    const nextRequesterId =
      payload.requesterId !== undefined || payload.requestedBy !== undefined
        ? resolveRequesterId(payload, true)
        : existing.requesterId;
    if (
      payload.requesterId !== undefined ||
      payload.requestedBy !== undefined
    ) {
      if (
        nextRequesterId === undefined ||
        nextRequesterId === null
      ) {
        throw new Error("requesterId is required");
      }
      await validateRequesterExists(nextRequesterId);
    }

    const nextSession = hasSessionInput(payload)
      ? resolveSession(payload)
      : {
          start: existing.startTime,
          end: existing.endTime,
        };

    const nextDate =
      payload.date !== undefined ? String(payload.date) : formatDateUTC(existing.date);

    const shouldRevalidate =
      nextstaffId !== existing.userId ||
      nextSession.start !== existing.startTime ||
      nextSession.end !== existing.endTime ||
      nextDate !== formatDateUTC(existing.date);

    const status =
      payload.status !== undefined
        ? normalizeStatus(String(payload.status))
        : existing.status;

    const branchId =
      payload.branch_id !== undefined
        ? await resolveBranchIdOrDefault(payload.branch_id)
        : undefined;

    const actorName = await getUserName(actorId);
    const byActor = actorName ? ` by ${actorName}` : "";
    let history: unknown = existing.history;
    if (shouldRevalidate) {
      history = appendHistory(
        history,
        `Moved to ${formatSlotLabel(nextDate, nextSession.start)}${byActor}`,
        "info",
      );
    }
    if (status !== existing.status) {
      const line = statusHistoryLine(status, byActor);
      history = appendHistory(history, line.text, line.tone);
    }
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // Moving to another time competes with new bookings for it, so it
      // takes the same lock; edits that keep the time skip both.
      if (shouldRevalidate) await lockStaffForBooking(tx, nextstaffId);
      const appointmentDate = shouldRevalidate
        ? await validateBookingWindow(tx, {
            staffId: nextstaffId,
            date: nextDate,
            session: nextSession,
            excludeAppointmentId: id,
          })
        : existing.date;

      return tx.appointment.update({
        where: { id },
        data: {
          fullName:
            payload.fullName !== undefined ? String(payload.fullName) : existing.fullName,
          email: payload.email !== undefined ? String(payload.email) : existing.email,
          phone: payload.phone !== undefined ? String(payload.phone) : existing.phone,
          purpose:
            payload.purpose !== undefined ? String(payload.purpose) : existing.purpose,
          note: payload.note !== undefined ? String(payload.note) : existing.note,
          date: appointmentDate,
          startTime: nextSession.start,
          endTime: nextSession.end,
          userId: nextstaffId,
          requesterId: nextRequesterId,
          ...(branchId !== undefined ? { branch_id: branchId } : {}),
          status,
          ...(status === "CONFIRMED" && existing.status !== "CONFIRMED"
            ? { acceptedAt: now, respondedAt: existing.respondedAt ?? now }
            : {}),
          ...(shouldRevalidate
            ? { reminderSentAt: null, outcomePromptedAt: null }
            : {}),
          history: history as Prisma.InputJsonValue,
        },
        include: appointmentInclude,
      });
    });

    return mapAppointmentWithRequester(updated);
  },

  // DELETE APPOINTMENT BOOKING
  async deleteBooking(id: number) {
    const booking = await prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });

    if (!booking) {
      throw new Error("Appointment not found");
    }

    await prisma.appointment.delete({ where: { id } });
    return mapAppointmentWithRequester(booking);
  },

  // FETCH BY STAFF
  async getByStaff(userId: number, scope?: AppointmentScope) {
    return AppointmentService.getAllBookings({ staffId: userId }, scope);
  },

  // FETCH BY CLIENT
  async getByClientEmail(email?: string, scope?: AppointmentScope) {
    return AppointmentService.getAllBookings({ email }, scope);
  },

  // UPDATE STATUS (PUT /status). Appends a history line when it changes.
  async updateStatus(
    id: number,
    app_status: appointment_status,
    actorId?: number,
  ) {
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { status: true, history: true, respondedAt: true },
    });
    if (!existing) {
      throw new Error("Appointment not found");
    }

    const now = new Date();
    let data: Prisma.appointmentUpdateInput = { status: app_status };
    if (existing.status !== app_status) {
      const actorName = await getUserName(actorId);
      const line = statusHistoryLine(app_status, actorName ? ` by ${actorName}` : "");
      data = {
        ...data,
        history: appendHistory(existing.history, line.text, line.tone, now) as Prisma.InputJsonValue,
        ...(app_status === "CONFIRMED"
          ? { acceptedAt: now, respondedAt: existing.respondedAt ?? now }
          : {}),
      };
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    });

    return mapAppointmentWithRequester(updated);
  },

  // The member who requested a booking cancels it (PUT /bookings/:id/cancel).
  // Allowed until `cancelCutoffHours` before the start.
  async cancelByRequester(id: number, callerId: number) {
    const booking = await prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });
    if (!booking) {
      throw new NotFoundError("Appointment not found");
    }
    if (booking.requesterId !== callerId) {
      throw new AppointmentForbiddenError("You can only cancel your own appointments");
    }
    if (booking.status === "CANCELLED") {
      throw new InputValidationError("This appointment is already cancelled");
    }
    if (!["PENDING", "CONFIRMED", "RESCHEDULED"].includes(booking.status)) {
      throw new InputValidationError("This appointment can't be cancelled any more.");
    }

    const settings = await AppointmentSettingsService.get();
    const now = new Date();
    const start = slotInstant(booking.date, booking.startTime);
    if (
      start &&
      start.getTime() - settings.cancelCutoffHours * 3_600_000 < now.getTime()
    ) {
      throw new InputValidationError(
        "It's too close to the appointment to cancel here. Call the church office instead.",
      );
    }

    const requesterName = (await getUserName(callerId)) || booking.fullName;
    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        history: appendHistory(
          booking.history,
          `Cancelled by ${requesterName}`,
          "warning",
          now,
        ) as Prisma.InputJsonValue,
      },
      include: appointmentInclude,
    });

    await notifyAppointmentEvent({
      event: "cancelled",
      booking: toNotifiableBooking(updated, requesterName),
      settings,
      actorId: callerId,
      dedupeSuffix: String(now.getTime()),
    });

    return mapAppointmentWithRequester(updated);
  },

  // PUT /appointment/availability/staff/:userId/pause
  async setStaffPaused(userId: number, paused: unknown) {
    if (typeof paused !== "boolean") {
      throw new InputValidationError("Send paused as true or false.");
    }
    await assertUserExists(userId);
    const profile = await prisma.appointment_staff_profile.upsert({
      where: { user_id: userId },
      create: { user_id: userId, paused },
      update: { paused },
    });
    return { userId, paused: profile.paused };
  },

  // POST /appointment/availability/staff/:userId/time-off
  async createTimeOff(userId: number, payload: any, actorId?: number) {
    const from = parseIsoDay(payload?.from);
    const to = parseIsoDay(payload?.to);
    if (!from || !to) {
      throw new InputValidationError("Choose a start and end date (YYYY-MM-DD).");
    }
    if (to.getTime() < from.getTime()) {
      throw new InputValidationError("The end date has to be on or after the start date.");
    }
    let note: string | null = null;
    if (payload?.note !== undefined && payload?.note !== null) {
      if (typeof payload.note !== "string") {
        throw new InputValidationError("The note has to be text.");
      }
      note = payload.note.trim() || null;
      if (note && note.length > 255) {
        throw new InputValidationError("Keep the note to 255 characters or fewer.");
      }
    }
    await assertUserExists(userId);
    const created = await prisma.appointment_time_off.create({
      data: {
        user_id: userId,
        from_date: from,
        to_date: to,
        note,
        created_by: actorId && actorId > 0 ? actorId : null,
      },
    });
    return mapTimeOff(created);
  },

  // DELETE /appointment/availability/time-off/:id
  async deleteTimeOff(id: number) {
    const existing = await prisma.appointment_time_off.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("We couldn't find that time off. It may already be removed.");
    }
    await prisma.appointment_time_off.delete({ where: { id } });
    return mapTimeOff(existing);
  },
};
