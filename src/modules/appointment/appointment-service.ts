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

export const AppointmentService = {
  // CREATE APPOINTMENT (With Overbooking Protection)
  async createAppointment(payload: any) {
    const { fullName, email, phone, purpose, note, userId, date, session } =
      payload;

    const bookingDate = new Date(date);

    // 1. Validation: Check how many people already booked this specific slot
    const staff = await prisma.availability.findFirst({
      where: { userId: Number(userId) },
      select: { maxBookingsPerSlot: true },
    });

    const currentBookingsCount = await prisma.appointment.count({
      where: {
        userId: Number(userId),
        date: bookingDate,
        startTime: session.start,
        status: { not: "CANCELLED" }, // Don't count cancelled ones
      },
    });

    // 2. Prevent booking if limit reached (default to 1 if not set)
    const limit = staff?.maxBookingsPerSlot || 1;
    if (currentBookingsCount >= limit) {
      throw new Error(`This slot is fully booked. Limit is ${limit}.`);
    }

    return await prisma.appointment.create({
      data: {
        fullName,
        email,
        phone,
        purpose,
        note: note || "",
        date: bookingDate,
        startTime: session.start,
        endTime: session.end,
        userId: Number(userId),
        status: "PENDING",
      },
    });
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

  // FETCH BY STAFF
  async getByStaff(userId: number) {
    return prisma.appointment.findMany({
      where: { userId },
      orderBy: { date: "asc" },
    });
  },

  // FETCH BY CLIENT
  async getByClientEmail(email?: string) {
    return prisma.appointment.findMany({
      where: { email },
      include: { user: true },
    });
  },

  // UPDATE STATUS
  async updateStatus(id: number, app_status: appointment_status) {
    return prisma.appointment.update({
      where: { id },
      data: { status: app_status },
    });
  },
};
