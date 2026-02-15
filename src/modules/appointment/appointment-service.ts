import { appointment_status } from "@prisma/client";
import { prisma } from "../../Models/context";

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
