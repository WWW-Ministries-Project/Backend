import { appointment_status } from "@prisma/client";
import { prisma } from "../../Models/context";

const availabilityInclude = {
  sessions: true,
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

function mapAppointmentOutput(appointment: any) {
  return {
    id: appointment.id,
    staffId: appointment.userId,
    attendeeName: appointment.user?.name ?? null,
    position: appointment.user?.position?.name ?? null,
    requester: {
      requesterId: appointment.requesterId ?? null,
      fullName: appointment.fullName,
      email: appointment.email,
      phone: appointment.phone,
    },
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
  };
}

function mapAvailabilityPayload(records: any[]) {
  const grouped = new Map<
    number,
    {
      userId: string;
      fullName: string | null;
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

async function validateBookingWindow(params: {
  staffId: number;
  date: string;
  session: { start: string; end: string };
  excludeAppointmentId?: number;
}) {
  const { staffId, date, session, excludeAppointmentId } = params;
  const { dayStart, dayEnd, dayName, appointmentDate } = parseDateInput(date);

  const availabilityCandidates = await prisma.availability.findMany({
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

  const existingSessionBooking = await prisma.appointment.findFirst({
    where: {
      userId: staffId,
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
      startTime: session.start,
      endTime: session.end,
      status: {
        not: "CANCELLED",
      },
      ...(excludeAppointmentId
        ? {
            id: {
              not: excludeAppointmentId,
            },
          }
        : {}),
    },
    select: { id: true },
  });

  if (existingSessionBooking) {
    throw new Error("This session is already booked");
  }

  const sessionFilters = availabilityForSession.sessions.map((s) => ({
    startTime: s.start,
    endTime: s.end,
  }));

  const bookedSessionsInBlock = await prisma.appointment.findMany({
    where: {
      userId: staffId,
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
      status: {
        not: "CANCELLED",
      },
      OR: sessionFilters,
      ...(excludeAppointmentId
        ? {
            id: {
              not: excludeAppointmentId,
            },
          }
        : {}),
    },
    select: {
      startTime: true,
      endTime: true,
    },
  });

  const uniqueBookedSessions = new Set(
    bookedSessionsInBlock.map(
      (booking) => `${booking.startTime}|${booking.endTime}`,
    ),
  );

  const limit = availabilityForSession.maxBookingsPerSlot || 1;
  if (uniqueBookedSessions.size >= limit) {
    throw new Error(
      "This availability block has reached its max number of booked sessions",
    );
  }

  return appointmentDate;
}

export const AppointmentService = {
  // CREATE APPOINTMENT (With Overbooking Protection)
  async createAppointment(payload: any) {
    const { fullName, email, phone, purpose, note } = payload;
    const staffId = resolvestaffId(payload);
    const requesterId = resolveRequesterId(payload, true);
    const session = resolveSession(payload);

    if (!payload?.date || typeof payload.date !== "string") {
      throw new Error("date is required in YYYY-MM-DD format");
    }

    const appointmentDate = await validateBookingWindow({
      staffId,
      date: payload.date,
      session,
    });

    const created = await prisma.appointment.create({
      data: {
        fullName,
        email,
        phone,
        purpose,
        note: note || "",
        date: appointmentDate,
        startTime: session.start,
        endTime: session.end,
        userId: staffId,
        requesterId,
        status: "PENDING",
      },
      include: appointmentInclude,
    });

    return mapAppointmentOutput(created);
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

    return await prisma.$transaction(async (tx) => {
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
  },

  // FETCH ALL AVAILABILITY (OPTIONAL STAFF FILTER)
  async getAllAvailability(userId?: number) {
    const availability = await prisma.availability.findMany({
      where: userId ? { userId } : undefined,
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });

    return mapAvailabilityPayload(availability);
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

    return prisma.$transaction(async (tx) => {
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

  // FETCH AVAILABILITY WITH SLOT/SESSION STATUS TAGS (ALL DAYS)
  async getAvailabilityWithSessionStatus() {
    const allAvailabilities = await prisma.availability.findMany({
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });

    if (allAvailabilities.length === 0) {
      return [];
    }

    const userIds = Array.from(new Set(allAvailabilities.map((a) => a.userId)));
    const availabilityDays = Array.from(
      new Set(
        allAvailabilities
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
      const dayWindow = getNextDateWindowForDay(day);
      dayWindows.set(day, dayWindow);
      if (!rangeStart || dayWindow.dayStart < rangeStart) {
        rangeStart = dayWindow.dayStart;
      }
      if (!rangeEnd || dayWindow.dayEnd > rangeEnd) {
        rangeEnd = dayWindow.dayEnd;
      }
    }

    const appointments =
      rangeStart && rangeEnd
        ? await prisma.appointment.findMany({
            where: {
              userId: { in: userIds },
              date: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              status: { not: "CANCELLED" },
            },
            select: {
              userId: true,
              startTime: true,
              endTime: true,
              date: true,
            },
          })
        : [];

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

    for (const availability of allAvailabilities) {
      if (!grouped.has(availability.userId)) {
        const userBookedSessions = Array.from(
          bookedSessionsByUser.get(availability.userId)?.values() ?? [],
        ).sort(
          (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
        );

        grouped.set(availability.userId, {
          userId: String(availability.userId),
          fullName: availability.user?.name ?? null,
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
  async getAllBookings(filters: {
    staffId?: number;
    requesterId?: number;
    email?: string;
    status?: string;
    date?: string;
  }) {
    const where: any = {};

    if (filters.staffId !== undefined) {
      where.userId = filters.staffId;
    }

    if (filters.requesterId !== undefined) {
      where.requesterId = filters.requesterId;
    }

    if (filters.email) {
      where.email = filters.email.trim();
    }

    if (filters.status) {
      where.status = normalizeStatus(filters.status);
    }

    if (filters.date) {
      const { dayStart, dayEnd } = parseDateInput(filters.date);
      where.date = {
        gte: dayStart,
        lte: dayEnd,
      };
    }

    const bookings = await prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return bookings.map(mapAppointmentOutput);
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

    return mapAppointmentOutput(booking);
  },

  // UPDATE APPOINTMENT BOOKING
  async updateBooking(id: number, payload: any) {
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

    const appointmentDate = shouldRevalidate
      ? await validateBookingWindow({
          staffId: nextstaffId,
          date: nextDate,
          session: nextSession,
          excludeAppointmentId: id,
        })
      : existing.date;

    const status =
      payload.status !== undefined
        ? normalizeStatus(String(payload.status))
        : existing.status;

    const updated = await prisma.appointment.update({
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
        status,
      },
      include: appointmentInclude,
    });

    return mapAppointmentOutput(updated);
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
    return mapAppointmentOutput(booking);
  },

  // FETCH BY STAFF
  async getByStaff(userId: number) {
    const bookings = await prisma.appointment.findMany({
      where: { userId },
      include: appointmentInclude,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return bookings.map(mapAppointmentOutput);
  },

  // FETCH BY CLIENT
  async getByClientEmail(email?: string) {
    const bookings = await prisma.appointment.findMany({
      where: { email },
      include: appointmentInclude,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return bookings.map(mapAppointmentOutput);
  },

  // UPDATE STATUS
  async updateStatus(id: number, app_status: appointment_status) {
    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: app_status },
      include: appointmentInclude,
    });

    return mapAppointmentOutput(updated);
  },
};
