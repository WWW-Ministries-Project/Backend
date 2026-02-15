import { appointment_status, Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";

const VALID_DAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

type SessionInput = {
  start: string;
  end: string;
};

type TimeSlotInput = {
  day: string;
  startTime: string;
  endTime: string;
  sessionDurationMinutes?: number;
  sessions: SessionInput[];
};

type SaveAvailabilityPayload = {
  staffId?: string | number;
  userId?: string | number; // backward compatible
  maxBookingsPerSlot?: string | number;
  timeSlots?: TimeSlotInput[];
};

type CreateAppointmentPayload = {
  fullName?: string;
  email?: string;
  phone?: string;
  purpose?: string;
  note?: string;
  staffId?: string | number;
  userId?: string | number; // backward compatible
  date?: string;
  session?: SessionInput;
};

type AvailabilityWithMeta = Prisma.availabilityGetPayload<{
  include: {
    sessions: true;
    user: {
      select: {
        name: true;
        position: {
          select: {
            name: true;
          };
        };
        access: {
          select: {
            name: true;
          };
        };
      };
    };
  };
}>;

type AppointmentWithMeta = Prisma.appointmentGetPayload<{
  include: {
    user: {
      select: {
        name: true;
        position: {
          select: {
            name: true;
          };
        };
        access: {
          select: {
            name: true;
          };
        };
      };
    };
  };
}>;

const APPOINTMENT_INCLUDE = {
  user: {
    select: {
      name: true,
      position: {
        select: {
          name: true,
        },
      },
      access: {
        select: {
          name: true,
        },
      },
    },
  },
} as const;

function ensureNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function parseStaffId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("staffId must be a valid positive integer");
  }
  return parsed;
}

function validateTime(value: unknown, fieldName: string): string {
  const parsed = ensureNonEmptyString(value, fieldName);
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timePattern.test(parsed)) {
    throw new Error(`${fieldName} must be in HH:mm format`);
  }
  return parsed;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseDate(dateValue: unknown): {
  bookingDate: Date;
  dayStart: Date;
  dayEnd: Date;
  weekDay: string;
} {
  const date = ensureNonEmptyString(dateValue, "date");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!datePattern.test(date)) {
    throw new Error("date must be in YYYY-MM-DD format");
  }

  const [year, month, day] = date.split("-").map(Number);
  const bookingDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (Number.isNaN(bookingDate.getTime())) {
    throw new Error("date is invalid");
  }

  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  const weekDays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const weekDay = weekDays[dayStart.getUTCDay()];

  return {
    bookingDate: dayStart,
    dayStart,
    dayEnd,
    weekDay,
  };
}

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatStatus(status: appointment_status): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function mapAppointment(appointment: AppointmentWithMeta) {
  return {
    id: appointment.id,
    staffId: String(appointment.userId),
    staffName: appointment.user.name,
    position: appointment.user.position?.name ?? null,
    role: appointment.user.access?.name ?? null,
    fullName: appointment.fullName,
    email: appointment.email,
    phone: appointment.phone,
    purpose: appointment.purpose,
    note: appointment.note ?? "",
    date: formatDateOnly(appointment.date),
    session: {
      start: appointment.startTime,
      end: appointment.endTime,
    },
    status: formatStatus(appointment.status),
    statusCode: appointment.status,
    createdAt: appointment.createdAt.toISOString(),
  };
}

function dayOrder(day: string): number {
  const orderMap: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };

  return orderMap[day] ?? 99;
}

function mapAvailabilityRows(rows: AvailabilityWithMeta[]) {
  const grouped = new Map<
    number,
    {
      id: string;
      staffId: string;
      staffName: string;
      position: string | null;
      role: string | null;
      maxBookingsPerSlot: number;
      timeSlots: {
        day: string;
        startTime: string;
        endTime: string;
        sessionDurationMinutes: number;
        sessions: { start: string; end: string }[];
      }[];
    }
  >();

  for (const row of rows) {
    if (!grouped.has(row.userId)) {
      grouped.set(row.userId, {
        id: `avail-${row.userId}`,
        staffId: String(row.userId),
        staffName: row.user.name,
        position: row.user.position?.name ?? null,
        role: row.user.access?.name ?? null,
        maxBookingsPerSlot: row.maxBookingsPerSlot,
        timeSlots: [],
      });
    }

    const current = grouped.get(row.userId)!;
    current.maxBookingsPerSlot = row.maxBookingsPerSlot;
    current.timeSlots.push({
      day: row.day,
      startTime: row.startTime,
      endTime: row.endTime,
      sessionDurationMinutes: row.sessionDurationMinutes,
      sessions: row.sessions
        .map((session) => ({ start: session.start, end: session.end }))
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    });
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      timeSlots: item.timeSlots.sort((a, b) => {
        const dayDiff = dayOrder(a.day) - dayOrder(b.day);
        if (dayDiff !== 0) {
          return dayDiff;
        }
        return toMinutes(a.startTime) - toMinutes(b.startTime);
      }),
    }))
    .sort((a, b) => Number(a.staffId) - Number(b.staffId));
}

function normalizeTimeSlots(timeSlots: TimeSlotInput[]) {
  return timeSlots.map((slot, index) => {
    const day = ensureNonEmptyString(slot.day, `timeSlots[${index}].day`)
      .toLowerCase()
      .trim();
    if (!VALID_DAYS.has(day)) {
      throw new Error(
        `timeSlots[${index}].day must be a valid weekday (monday-sunday)`,
      );
    }

    const startTime = validateTime(
      slot.startTime,
      `timeSlots[${index}].startTime`,
    );
    const endTime = validateTime(slot.endTime, `timeSlots[${index}].endTime`);
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      throw new Error(
        `timeSlots[${index}].endTime must be later than startTime`,
      );
    }

    const duration = Number(slot.sessionDurationMinutes ?? 30);
    if (!Number.isInteger(duration) || duration <= 0) {
      throw new Error(
        `timeSlots[${index}].sessionDurationMinutes must be a positive integer`,
      );
    }

    if (!Array.isArray(slot.sessions) || slot.sessions.length === 0) {
      throw new Error(`timeSlots[${index}].sessions is required`);
    }

    const normalizedSessions = slot.sessions.map((session, sessionIndex) => {
      const sessionStart = validateTime(
        session.start,
        `timeSlots[${index}].sessions[${sessionIndex}].start`,
      );
      const sessionEnd = validateTime(
        session.end,
        `timeSlots[${index}].sessions[${sessionIndex}].end`,
      );

      const sessionStartMinutes = toMinutes(sessionStart);
      const sessionEndMinutes = toMinutes(sessionEnd);

      if (sessionStartMinutes >= sessionEndMinutes) {
        throw new Error(
          `timeSlots[${index}].sessions[${sessionIndex}] end must be later than start`,
        );
      }

      if (
        sessionStartMinutes < toMinutes(startTime) ||
        sessionEndMinutes > toMinutes(endTime)
      ) {
        throw new Error(
          `timeSlots[${index}].sessions[${sessionIndex}] must be within ${startTime}-${endTime}`,
        );
      }

      if (sessionEndMinutes - sessionStartMinutes !== duration) {
        throw new Error(
          `timeSlots[${index}].sessions[${sessionIndex}] must be exactly ${duration} minutes`,
        );
      }

      return {
        start: sessionStart,
        end: sessionEnd,
      };
    });

    const sortedSessions = [...normalizedSessions].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start),
    );

    for (let i = 1; i < sortedSessions.length; i++) {
      const previous = sortedSessions[i - 1];
      const current = sortedSessions[i];

      if (toMinutes(current.start) < toMinutes(previous.end)) {
        throw new Error(
          `timeSlots[${index}].sessions contain overlapping session ranges`,
        );
      }
    }

    return {
      day,
      startTime,
      endTime,
      sessionDurationMinutes: duration,
      sessions: sortedSessions,
    };
  });
}

async function assertStaffExists(staffId: number) {
  const staff = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true },
  });

  if (!staff) {
    throw new Error(`Staff with id ${staffId} does not exist`);
  }
}

export const AppointmentService = {
  // CREATE APPOINTMENT
  async createAppointment(payload: CreateAppointmentPayload) {
    const fullName = ensureNonEmptyString(payload.fullName, "fullName");
    const email = ensureNonEmptyString(payload.email, "email").toLowerCase();
    const phone = ensureNonEmptyString(payload.phone, "phone");
    const purpose = ensureNonEmptyString(payload.purpose, "purpose");
    const note = typeof payload.note === "string" ? payload.note.trim() : "";

    const staffId = parseStaffId(payload.staffId ?? payload.userId);
    await assertStaffExists(staffId);

    if (!payload.session) {
      throw new Error("session is required");
    }

    const sessionStart = validateTime(payload.session.start, "session.start");
    const sessionEnd = validateTime(payload.session.end, "session.end");
    if (toMinutes(sessionStart) >= toMinutes(sessionEnd)) {
      throw new Error("session.end must be later than session.start");
    }

    const { bookingDate, dayStart, dayEnd, weekDay } = parseDate(payload.date);

    const slotAvailability = await prisma.availability.findFirst({
      where: {
        userId: staffId,
        day: weekDay,
        sessions: {
          some: {
            start: sessionStart,
            end: sessionEnd,
          },
        },
      },
      select: {
        maxBookingsPerSlot: true,
      },
    });

    if (!slotAvailability) {
      throw new Error(
        `Selected session is not available for this staff on ${weekDay}`,
      );
    }

    const currentBookingsCount = await prisma.appointment.count({
      where: {
        userId: staffId,
        date: {
          gte: dayStart,
          lte: dayEnd,
        },
        startTime: sessionStart,
        endTime: sessionEnd,
        status: {
          not: "CANCELLED",
        },
      },
    });

    const limit = slotAvailability.maxBookingsPerSlot || 1;
    if (currentBookingsCount >= limit) {
      throw new Error(`This slot is fully booked. Limit is ${limit}.`);
    }

    const createdAppointment = await prisma.appointment.create({
      data: {
        fullName,
        email,
        phone,
        purpose,
        note,
        date: bookingDate,
        startTime: sessionStart,
        endTime: sessionEnd,
        userId: staffId,
        status: "PENDING",
      },
      include: APPOINTMENT_INCLUDE,
    });

    return mapAppointment(createdAppointment);
  },

  // SET AVAILABILITY
  async saveStaffAvailability(payload: SaveAvailabilityPayload) {
    const staffId = parseStaffId(payload.staffId ?? payload.userId);
    await assertStaffExists(staffId);

    const maxBookingsPerSlot = Number(payload.maxBookingsPerSlot);
    if (!Number.isInteger(maxBookingsPerSlot) || maxBookingsPerSlot <= 0) {
      throw new Error("maxBookingsPerSlot must be a positive integer");
    }

    if (!Array.isArray(payload.timeSlots) || payload.timeSlots.length === 0) {
      throw new Error("timeSlots is required");
    }

    const normalizedTimeSlots = normalizeTimeSlots(payload.timeSlots);

    const savedRows = await prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({
        where: {
          userId: staffId,
        },
      });

      const createdRows: AvailabilityWithMeta[] = [];

      for (const slot of normalizedTimeSlots) {
        const created = await tx.availability.create({
          data: {
            userId: staffId,
            day: slot.day,
            maxBookingsPerSlot,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionDurationMinutes: slot.sessionDurationMinutes,
            sessions: {
              create: slot.sessions.map((session) => ({
                start: session.start,
                end: session.end,
              })),
            },
          },
          include: {
            sessions: true,
            user: {
              select: {
                name: true,
                position: {
                  select: {
                    name: true,
                  },
                },
                access: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

        createdRows.push(created);
      }

      return createdRows;
    });

    return mapAvailabilityRows(savedRows)[0];
  },

  // FETCH AVAILABILITY
  async getAvailability(staffId?: number) {
    const rows = await prisma.availability.findMany({
      where: staffId
        ? {
            userId: staffId,
          }
        : undefined,
      include: {
        sessions: true,
        user: {
          select: {
            name: true,
            position: {
              select: {
                name: true,
              },
            },
            access: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ userId: "asc" }, { day: "asc" }, { startTime: "asc" }],
    });

    return mapAvailabilityRows(rows);
  },

  // FETCH BY STAFF
  async getByStaff(staffId: number) {
    const appointments = await prisma.appointment.findMany({
      where: { userId: staffId },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: APPOINTMENT_INCLUDE,
    });

    return appointments.map(mapAppointment);
  },

  // FETCH BY USER (BOOKER)
  async getByUser(filters: { email?: string; phone?: string }) {
    const email = filters.email?.trim().toLowerCase();
    const phone = filters.phone?.trim();

    if (!email && !phone) {
      throw new Error("Provide email or phone to fetch appointments");
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
      include: APPOINTMENT_INCLUDE,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return appointments.map(mapAppointment);
  },

  // backward-compatible alias
  async getByClientEmail(email?: string) {
    return this.getByUser({ email });
  },

  // UPDATE STATUS
  async updateStatus(id: number, appStatus: appointment_status) {
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new Error("Appointment not found");
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: appStatus },
      include: APPOINTMENT_INCLUDE,
    });

    return mapAppointment(updated);
  },
};
