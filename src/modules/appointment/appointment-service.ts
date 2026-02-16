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
  const staffId = Number(payload.userId ?? payload.staffId ?? payload.staffId);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    throw new Error("staffId (or userId/staffId) must be a valid number");
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

function resolveSession(payload: any) {
  if (
    !payload?.session ||
    typeof payload.session.start !== "string" ||
    !payload.session.start.trim() ||
    typeof payload.session.end !== "string" ||
    !payload.session.end.trim()
  ) {
    throw new Error("session with valid start and end is required");
  }

  return {
    start: payload.session.start.trim(),
    end: payload.session.end.trim(),
  };
}

function formatDateUTC(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function validateBookingWindow(params: {
  staffId: number;
  date: string;
  session: { start: string; end: string };
  excludeAppointmentId?: number;
}) {
  const { staffId, date, session, excludeAppointmentId } = params;
  const { dayStart, dayEnd, dayName, appointmentDate } = parseDateInput(date);

  const availabilityForSession = await prisma.availability.findFirst({
    where: {
      userId: staffId,
      day: dayName,
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

    return await prisma.$transaction(async (tx) => {
      // Update the user's max booking limit
      await tx.availability.deleteMany({ where: { userId: Number(userId) } });

      for (const slot of timeSlots) {
        await tx.availability.create({
          data: {
            userId: Number(userId),
            day: slot.day,
            maxBookingsPerSlot: Number(maxBookingsPerSlot),
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionDurationMinutes: slot.sessionDurationMinutes,
            sessions: {
              create: slot.sessions.map((s: any) => ({
                start: s.start,
                end: s.end,
              })),
            },
          },
        });
      }
    });
  },

  // FETCH ALL AVAILABILITY (OPTIONAL STAFF FILTER)
  async getAllAvailability(userId?: number) {
    return prisma.availability.findMany({
      where: userId ? { userId } : undefined,
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });
  },

  // UPDATE AVAILABILITY SLOT
  async updateAvailability(id: number, payload: any) {
    const existing = await prisma.availability.findUnique({
      where: { id },
      select: { id: true },
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
      updateData.day = payload.day.trim().toLowerCase();
    }

    if (payload.maxBookingsPerSlot !== undefined) {
      const parsedLimit = Number(payload.maxBookingsPerSlot);
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

    return prisma.availability.update({
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
      include: availabilityInclude,
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

  // FETCH AVAILABILITY FOR TODAY WITH SLOT/SESSION STATUS TAGS
  async getAvailabilityWithSessionStatus() {
    const { dayStart, dayEnd, dayName } = parseDateInput();

    const availabilities = await prisma.availability.findMany({
      where: { day: dayName },
      include: availabilityInclude,
      orderBy: [{ userId: "asc" }, { startTime: "asc" }],
    });

    if (availabilities.length === 0) {
      return {
        users: [],
      };
    }

    const userIds = Array.from(new Set(availabilities.map((a) => a.userId)));

    const appointments = await prisma.appointment.findMany({
      where: {
        userId: { in: userIds },
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
        status: { not: "CANCELLED" },
      },
      select: {
        userId: true,
        startTime: true,
        endTime: true,
      },
    });

    const appointmentsByUser = new Map<
      number,
      Array<{ startTime: string; endTime: string }>
    >();
    for (const booking of appointments) {
      if (!appointmentsByUser.has(booking.userId)) {
        appointmentsByUser.set(booking.userId, []);
      }
      appointmentsByUser.get(booking.userId)!.push({
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
    }

    const usersMap = new Map<
      number,
      {
        userId: number;
        staffName: string;
        position: string | null;
        timeSlots: Array<{
          availabilityId: number;
          day: string;
          startTime: string;
          endTime: string;
          maxBookingsPerSlot: number;
          sessionDurationMinutes: number;
          status: "AVAILABLE" | "BOOKED";
          sessions: Array<{
            id: number;
            start: string;
            end: string;
            availabilityId: number;
            status: "AVAILABLE" | "BOOKED";
          }>;
        }>;
      }
    >();

    for (const availability of availabilities) {
      if (!usersMap.has(availability.userId)) {
        usersMap.set(availability.userId, {
          userId: availability.userId,
          staffName: availability.user.name,
          position: availability.user.position?.name ?? null,
          timeSlots: [],
        });
      }

      const slotLimit = availability.maxBookingsPerSlot || 1;
      const slotSessionKeys = new Set(
        availability.sessions.map((session) => `${session.start}|${session.end}`),
      );
      const userDayBookings = appointmentsByUser.get(availability.userId) || [];
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
          const sessionKey = `${session.start}|${session.end}`;
          const sessionIsBooked = bookedSessionsInSlot.has(sessionKey);
          const sessionStatus: "AVAILABLE" | "BOOKED" =
            slotMaxReached || sessionIsBooked ? "BOOKED" : "AVAILABLE";

          return {
            id: session.id,
            start: session.start,
            end: session.end,
            availabilityId: session.availabilityId,
            status: sessionStatus,
          };
        })
        .sort((a, b) => a.start.localeCompare(b.start));

      usersMap.get(availability.userId)!.timeSlots.push({
        availabilityId: availability.id,
        day: availability.day,
        startTime: availability.startTime,
        endTime: availability.endTime,
        maxBookingsPerSlot: slotLimit,
        sessionDurationMinutes: availability.sessionDurationMinutes,
        status: slotStatus,
        sessions: slotSessions,
      });
    }

    return {
      users: Array.from(usersMap.values()),
    };
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
      payload.staffId !== undefined
        ? resolvestaffId(payload)
        : existing.userId;
    const nextRequesterId =
      payload.requesterId !== undefined || payload.requestedBy !== undefined
        ? resolveRequesterId(payload, true)
        : existing.requesterId;

    const nextSession = payload.session
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
