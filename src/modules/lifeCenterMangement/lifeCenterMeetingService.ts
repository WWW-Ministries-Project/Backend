import { prisma } from "../../Models/context";

export type NewFirstTimerInput = {
  title?: string;
  first_name: string;
  last_name: string;
  other_name?: string;
  contact_number: string;
  country_code?: string;
  contact_email?: string;
  country: string;
  city: string;
  date_won: Date;
  wonById: number;
};

export type CreateMeetingInput = {
  lifeCenterId: number;
  date: Date;
  offeringAmount: string;
  currency: string;
  note?: string | null;
  createdById: number;
  attendeeSoulWonIds: number[];
  firstTimerSoulWonIds: number[];
  newFirstTimers: NewFirstTimerInput[];
};

export type UpdateMeetingInput = Omit<CreateMeetingInput, "createdById">;

const ATTENDEE_INCLUDE = {
  attendees: {
    include: {
      soulWon: {
        select: { id: true, first_name: true, last_name: true },
      },
    },
  },
} as const;

const NO_ATTENDEES_ERROR =
  "A meeting must have at least one attendee or first-timer";

export class LifeCenterMeetingService {
  /**
   * Dedupes attendeeSoulWonIds/firstTimerSoulWonIds (an id present in both
   * lists is treated as a first-timer) and returns the resulting distinct
   * attendee count, computed purely from the input arrays — no DB
   * round-trip. This lets callers reject an empty meeting BEFORE any
   * database write happens.
   */
  private countDistinctAttendees(
    attendeeSoulWonIds: number[],
    firstTimerSoulWonIds: number[],
    newFirstTimersCount: number,
  ): number {
    const firstTimerIds = new Set<number>(firstTimerSoulWonIds);
    const attendeeOnlyIds = new Set<number>(attendeeSoulWonIds);
    for (const id of firstTimerIds) {
      attendeeOnlyIds.delete(id);
    }
    return attendeeOnlyIds.size + firstTimerIds.size + newFirstTimersCount;
  }

  private async replaceAttendees(
    meetingId: number,
    attendeeSoulWonIds: number[],
    firstTimerSoulWonIds: number[],
    newFirstTimers: NewFirstTimerInput[],
    lifeCenterId: number,
    fallbackWonById: number,
  ) {
    const createdFirstTimers = await Promise.all(
      newFirstTimers.map((soul) =>
        prisma.soul_won.create({
          data: {
            title: soul.title,
            first_name: soul.first_name,
            last_name: soul.last_name,
            other_name: soul.other_name,
            contact_number: soul.contact_number,
            country_code: soul.country_code,
            contact_email: soul.contact_email,
            country: soul.country,
            city: soul.city,
            date_won: soul.date_won,
            wonById: soul.wonById || fallbackWonById,
            lifeCenterId,
          },
        }),
      ),
    );

    // A soul id present in both lists is treated as a first-timer. Both
    // input lists are deduped via Set so repeated ids in the request never
    // reach createMany (which would otherwise violate the
    // @@unique([meetingId, soulWonId]) constraint and surface a raw P2002).
    const firstTimerIds = new Set<number>([
      ...firstTimerSoulWonIds,
      ...createdFirstTimers.map((s) => s.id),
    ]);
    const attendeeOnlyIds = Array.from(
      new Set<number>(attendeeSoulWonIds),
    ).filter((id) => !firstTimerIds.has(id));

    await prisma.life_center_meeting_attendee.deleteMany({
      where: { meetingId },
    });

    const rows = [
      ...attendeeOnlyIds.map((soulWonId) => ({
        meetingId,
        soulWonId,
        isFirstTimer: false,
      })),
      ...Array.from(firstTimerIds).map((soulWonId) => ({
        meetingId,
        soulWonId,
        isFirstTimer: true,
      })),
    ];

    if (rows.length) {
      await prisma.life_center_meeting_attendee.createMany({ data: rows });
    }
  }

  async createMeeting(data: CreateMeetingInput) {
    // Validate BEFORE any write: computed purely from the input arrays, so
    // a request that would result in zero attendees never touches the DB.
    const attendeeCount = this.countDistinctAttendees(
      data.attendeeSoulWonIds,
      data.firstTimerSoulWonIds,
      data.newFirstTimers.length,
    );
    if (attendeeCount === 0) {
      throw new Error(NO_ATTENDEES_ERROR);
    }

    const meeting = await prisma.life_center_meeting.create({
      data: {
        lifeCenterId: data.lifeCenterId,
        date: data.date,
        offeringAmount: data.offeringAmount,
        currency: data.currency,
        note: data.note ?? null,
        createdById: data.createdById,
      },
    });

    await this.replaceAttendees(
      meeting.id,
      data.attendeeSoulWonIds,
      data.firstTimerSoulWonIds,
      data.newFirstTimers,
      data.lifeCenterId,
      data.createdById,
    );

    return this.getMeetingById(meeting.id);
  }

  async updateMeeting(id: number, data: UpdateMeetingInput, actorId: number) {
    const existing = await prisma.life_center_meeting.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new Error("Meeting not found");
    }

    // Validate BEFORE any write: computed purely from the input arrays, so
    // a rejected update never mutates the meeting or its attendee rows.
    const attendeeCount = this.countDistinctAttendees(
      data.attendeeSoulWonIds,
      data.firstTimerSoulWonIds,
      data.newFirstTimers.length,
    );
    if (attendeeCount === 0) {
      throw new Error(NO_ATTENDEES_ERROR);
    }

    await prisma.life_center_meeting.update({
      where: { id },
      data: {
        lifeCenterId: data.lifeCenterId,
        date: data.date,
        offeringAmount: data.offeringAmount,
        currency: data.currency,
        note: data.note ?? null,
      },
    });

    await this.replaceAttendees(
      id,
      data.attendeeSoulWonIds,
      data.firstTimerSoulWonIds,
      data.newFirstTimers,
      data.lifeCenterId,
      actorId,
    );

    return this.getMeetingById(id);
  }

  async deleteMeeting(id: number) {
    const existing = await prisma.life_center_meeting.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new Error("Meeting not found");
    }
    await prisma.life_center_meeting.delete({ where: { id } });
    return existing;
  }

  async getMeetingById(id: number) {
    return prisma.life_center_meeting.findUnique({
      where: { id },
      include: ATTENDEE_INCLUDE,
    });
  }

  async getMeetings(filter: {
    lifeCenterId?: number;
    createdById: number;
    skip: number;
    take: number;
  }) {
    const where = {
      createdById: filter.createdById,
      ...(filter.lifeCenterId ? { lifeCenterId: filter.lifeCenterId } : {}),
    };

    const [total, meetings] = await Promise.all([
      prisma.life_center_meeting.count({ where }),
      prisma.life_center_meeting.findMany({
        where,
        include: ATTENDEE_INCLUDE,
        orderBy: { date: "desc" },
        skip: filter.skip,
        take: filter.take,
      }),
    ]);

    return { total, meetings };
  }

  async getEligibleFirstTimers(lifeCenterId: number) {
    return prisma.soul_won.findMany({
      where: {
        lifeCenterId,
        life_center_meeting_attendee: { none: {} },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        title: true,
      },
      orderBy: { first_name: "asc" },
    });
  }
}

export const lifeCenterMeetingService = new LifeCenterMeetingService();
