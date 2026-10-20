import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  LifeCenterHttpError,
  cityFromLocation,
  isLeaderRoleName,
  utcDayBounds,
} from "./lifeCenterHelpers";

/**
 * A first-timer recorded with the meeting. Only the name and number are
 * required; the rest defaults from the meeting (see replaceAttendees).
 */
export type NewFirstTimerInput = {
  title?: string;
  first_name: string;
  last_name: string;
  other_name?: string;
  gender?: string;
  contact_number: string;
  country_code?: string;
  contact_email?: string;
  country?: string;
  city?: string;
  date_won?: Date;
  wonById?: number;
};

export type CreateMeetingInput = {
  lifeCenterId: number;
  date: Date;
  offeringAmount: string;
  currency: string;
  note?: string | null;
  createdById: number;
  memberUserIds: number[];
  attendeeSoulWonIds: number[];
  firstTimerSoulWonIds: number[];
  newFirstTimers: NewFirstTimerInput[];
};

export type UpdateMeetingInput = Omit<CreateMeetingInput, "createdById">;

export const MEETING_INCLUDE = {
  attendees: {
    include: {
      soulWon: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          contact_number: true,
          country_code: true,
          gender: true,
        },
      },
    },
  },
  members: {
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          life_center_member: {
            select: { lifeCenterId: true, role: { select: { name: true } } },
          },
        },
      },
    },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.life_center_meetingInclude;

export const NO_ATTENDEES_ERROR = "A meeting needs at least one member or first-timer.";
export const DUPLICATE_MEETING_ERROR = "A meeting is already recorded for this date.";

const uniqueIds = (ids: number[]) =>
  Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));

export class LifeCenterMeetingService {
  /**
   * Distinct people at the meeting, computed purely from the input so an empty
   * meeting is rejected BEFORE any write. A soul id in both attendee lists is
   * counted once.
   */
  private countDistinctAttendees(data: UpdateMeetingInput): number {
    const souls = new Set<number>([
      ...uniqueIds(data.attendeeSoulWonIds),
      ...uniqueIds(data.firstTimerSoulWonIds),
    ]);
    return (
      uniqueIds(data.memberUserIds).length + souls.size + data.newFirstTimers.length
    );
  }

  private async loadCenter(tx: Prisma.TransactionClient, lifeCenterId: number) {
    const center = await tx.life_center.findUnique({
      where: { id: lifeCenterId },
      select: {
        id: true,
        meetingLocation: true,
        life_center_member: {
          select: { userId: true, role: { select: { name: true } } },
        },
      },
    });
    if (!center) throw new LifeCenterHttpError(404, "Life center not found");
    return center;
  }

  /** One meeting per center per (UTC) day. */
  private async assertNoDuplicate(
    tx: Prisma.TransactionClient,
    lifeCenterId: number,
    date: Date,
    excludeMeetingId?: number,
  ) {
    const { start, end } = utcDayBounds(date);
    const duplicate = await tx.life_center_meeting.findFirst({
      where: {
        lifeCenterId,
        date: { gte: start, lt: end },
        ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new LifeCenterHttpError(409, DUPLICATE_MEETING_ERROR);
  }

  /**
   * Members who came. They must belong to the center, except people already on
   * this meeting (someone removed from the center keeps past attendance).
   */
  private async replaceMembers(
    tx: Prisma.TransactionClient,
    meetingId: number,
    memberUserIds: number[],
    centerMemberIds: number[],
  ) {
    const ids = uniqueIds(memberUserIds);
    const existing = await tx.life_center_meeting_member.findMany({
      where: { meetingId },
      select: { userId: true },
    });
    const allowed = new Set<number>([
      ...centerMemberIds,
      ...existing.map((row) => row.userId),
    ]);
    if (ids.some((id) => !allowed.has(id))) {
      throw new LifeCenterHttpError(
        400,
        "memberUserIds must be members of this life center",
      );
    }

    await tx.life_center_meeting_member.deleteMany({ where: { meetingId } });
    if (ids.length) {
      await tx.life_center_meeting_member.createMany({
        data: ids.map((userId) => ({ meetingId, userId })),
      });
    }
  }

  private async replaceAttendees(
    tx: Prisma.TransactionClient,
    meetingId: number,
    data: UpdateMeetingInput,
    defaults: { city: string; wonById: number },
  ) {
    const createdFirstTimers: { id: number }[] = [];
    for (const soul of data.newFirstTimers) {
      createdFirstTimers.push(
        await tx.soul_won.create({
          data: {
            title: soul.title,
            first_name: soul.first_name,
            last_name: soul.last_name,
            other_name: soul.other_name,
            gender: soul.gender,
            contact_number: soul.contact_number,
            country_code: soul.country_code,
            contact_email: soul.contact_email,
            country: soul.country ?? "",
            city: soul.city || defaults.city,
            date_won: soul.date_won ?? data.date,
            wonById: soul.wonById || defaults.wonById,
            lifeCenterId: data.lifeCenterId,
          },
          select: { id: true },
        }),
      );
    }

    // A soul id present in both lists is treated as a first-timer. Both lists
    // are deduped so repeated ids never violate @@unique([meetingId, soulWonId]).
    const firstTimerIds = new Set<number>([
      ...uniqueIds(data.firstTimerSoulWonIds),
      ...createdFirstTimers.map((s) => s.id),
    ]);
    const attendeeOnlyIds = uniqueIds(data.attendeeSoulWonIds).filter(
      (id) => !firstTimerIds.has(id),
    );

    await tx.life_center_meeting_attendee.deleteMany({ where: { meetingId } });

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
      await tx.life_center_meeting_attendee.createMany({ data: rows });
    }
  }

  private async writeMeeting(
    meetingId: number | null,
    data: UpdateMeetingInput,
    actorId: number,
  ) {
    if (this.countDistinctAttendees(data) === 0) {
      throw new LifeCenterHttpError(400, NO_ATTENDEES_ERROR);
    }

    const id = await prisma.$transaction(async (tx) => {
      const center = await this.loadCenter(tx, data.lifeCenterId);
      await this.assertNoDuplicate(
        tx,
        data.lifeCenterId,
        data.date,
        meetingId ?? undefined,
      );

      const fields = {
        lifeCenterId: data.lifeCenterId,
        date: data.date,
        offeringAmount: data.offeringAmount,
        currency: data.currency,
        note: data.note ?? null,
      };
      const meeting = meetingId
        ? await tx.life_center_meeting.update({
            where: { id: meetingId },
            data: fields,
          })
        : await tx.life_center_meeting.create({
            data: { ...fields, createdById: actorId },
          });

      const leader = center.life_center_member.find((m) =>
        isLeaderRoleName(m.role?.name),
      );
      await this.replaceMembers(
        tx,
        meeting.id,
        data.memberUserIds,
        center.life_center_member.map((m) => m.userId),
      );
      await this.replaceAttendees(tx, meeting.id, data, {
        city: cityFromLocation(center.meetingLocation),
        wonById: leader?.userId || actorId,
      });
      return meeting.id;
    });

    return this.getMeetingById(id);
  }

  async createMeeting(data: CreateMeetingInput) {
    const { createdById, ...rest } = data;
    return this.writeMeeting(null, rest, createdById);
  }

  async updateMeeting(id: number, data: UpdateMeetingInput, actorId: number) {
    const existing = await prisma.life_center_meeting.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new LifeCenterHttpError(404, "Meeting not found");
    return this.writeMeeting(id, data, actorId);
  }

  async deleteMeeting(id: number) {
    const existing = await prisma.life_center_meeting.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new LifeCenterHttpError(404, "Meeting not found");
    }
    // Attendee and member rows cascade with the meeting.
    await prisma.life_center_meeting.delete({ where: { id } });
    return existing;
  }

  async getMeetingById(id: number) {
    return prisma.life_center_meeting.findUnique({
      where: { id },
      include: MEETING_INCLUDE,
    });
  }

  /**
   * Meetings visible to the caller. `lifeCenterIds` is the caller's scope
   * (undefined = every center).
   */
  async getMeetings(filter: {
    lifeCenterId?: number;
    lifeCenterIds?: number[];
    skip: number;
    take: number;
  }) {
    const where: Prisma.life_center_meetingWhereInput = filter.lifeCenterId
      ? { lifeCenterId: filter.lifeCenterId }
      : filter.lifeCenterIds
        ? { lifeCenterId: { in: filter.lifeCenterIds } }
        : {};

    const [total, meetings] = await Promise.all([
      prisma.life_center_meeting.count({ where }),
      prisma.life_center_meeting.findMany({
        where,
        include: MEETING_INCLUDE,
        orderBy: [{ date: "desc" }, { id: "desc" }],
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
