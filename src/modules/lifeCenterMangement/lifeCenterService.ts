import { prisma } from "../../Models/context";
import { roleEligibilityService } from "../settings/roleEligibilityService";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";
import {
  LeaderReminderReason,
  LifeCenterHttpError,
  LifeCenterScope,
  REMIND_LEADER_COOLDOWN_MS,
  isLeaderRoleName,
  isMemberScope,
  isReminderOnCooldown,
  leaderReminderCopy,
  parseMeetingDays,
  toDateKey,
} from "./lifeCenterHelpers";
import {
  resolveTargetRole,
  setLeaderTx,
  demoteOtherLeaders,
} from "./lifeCenterRoleAssignment";

/** Meetings counted for a member's attendance (`attended` of `of`). */
const ATTENDANCE_WINDOW = 10;
/** recent_meetings per center in the overview. */
const RECENT_MEETINGS = 8;

const findLeader = (
  members: { role?: { name: string } | null; user?: { id: number; name: string } | null }[],
) => {
  const leader = members.find((m) => isLeaderRoleName(m.role?.name) && m.user);
  return leader?.user ? { user_id: leader.user.id, name: leader.user.name } : null;
};

export class LifeCenterService {
  /**
   * Create a new LifeCenter
   */
  async create(data: {
    name: string;
    description: string;
    meetingLocation: string;
    meetingDays: string;
    branch_id?: number | string | null;
    leaderUserId?: number;
  }) {
    if (data.leaderUserId) {
      await roleEligibilityService.assertEligible(
        "life_center_leader",
        data.leaderUserId,
      );
    }
    const branchId = await resolveBranchIdOrDefault(data.branch_id);

    const response = await prisma.$transaction(async (tx) => {
      const center = await tx.life_center.create({
        data: {
          name: data.name,
          description: data.description,
          meetingLocation: data.meetingLocation,
          meetingDays: data.meetingDays,
          branch_id: branchId,
        },
      });
      if (data.leaderUserId) {
        await setLeaderTx(tx, center.id, data.leaderUserId);
      }
      return center;
    });

    if (response) {
      const response_data = {
        id: response.id,
        name: response.name,
        description: response.description,
        location: response.meetingLocation,
        meeting_dates: parseMeetingDays(response.meetingDays),
        branch_id: response.branch_id ?? null,
        created_at: toDateKey(response.createdAt),
      };
      return response_data;
    }

    return null;
  }

  async getAllLifeCenters(branchId?: unknown) {
    const results = await prisma.life_center.findMany({
      where: getBranchScopedWhere(branchId),
      orderBy: {
        name: "asc",
      },
      include: {
        _count: {
          select: {
            life_center_member: true,
            soul_won: true,
          },
        },
      },
    });

    return results.map((response) => {
      return {
        id: response.id,
        name: response.name,
        description: response.description,
        location: response.meetingLocation,
        meeting_dates: response.meetingDays.split(",").map((day) => day.trim()),
        totalMembers: response._count.life_center_member,
        totalSoulsWon: response._count.soul_won,
        branch_id: response.branch_id ?? null,
      };
    });
  }

  async getLifeCenterById(id: number) {
    const raw: any = await prisma.life_center.findUnique({
      where: { id },
      include: {
        life_center_member: {
          select: {
            id: true,
            role: {
              select: { id: true, name: true },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                user_info: { select: { primary_number: true } },
              },
            },
          },
        },
        soul_won: {
          select: {
            id: true,
            title: true,
            gender: true,
            first_name: true,
            last_name: true,
            contact_email: true,
            city: true,
            date_won: true,
            country: true,
            other_name: true,
            contact_number: true,
            country_code: true,
            memberId: true,
            wonBy: {
              select: { id: true, name: true },
            },
            member: {
              select: {
                id: true,
                name: true,
                email: true,
                member_id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!raw) return null;

    // Attendance over the center's last 10 meetings.
    const lastMeetings = await prisma.life_center_meeting.findMany({
      where: { lifeCenterId: id },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: ATTENDANCE_WINDOW,
      select: { members: { select: { userId: true } } },
    });
    const attendedBy = new Map<number, number>();
    for (const meeting of lastMeetings) {
      for (const row of meeting.members) {
        attendedBy.set(row.userId, (attendedBy.get(row.userId) ?? 0) + 1);
      }
    }

    // First meeting each soul came to (any attendance).
    const soulIds = raw.soul_won.map((soul: any) => soul.id);
    const soulAttendance = soulIds.length
      ? await prisma.life_center_meeting_attendee.findMany({
          where: { soulWonId: { in: soulIds } },
          select: { soulWonId: true, meeting: { select: { date: true } } },
        })
      : [];
    const firstMeetingBySoul = new Map<number, Date>();
    for (const row of soulAttendance) {
      const current = firstMeetingBySoul.get(row.soulWonId);
      if (!current || row.meeting.date < current) {
        firstMeetingBySoul.set(row.soulWonId, row.meeting.date);
      }
    }

    // Structure the response
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      location: raw.meetingLocation,
      meeting_dates: parseMeetingDays(raw.meetingDays),
      branch_id: raw.branch_id ?? null,
      created_at: toDateKey(raw.createdAt),
      leader: findLeader(raw.life_center_member),

      members: raw.life_center_member.map((member: any) => ({
        id: member.id,
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
        phone: member.user.user_info?.primary_number || null,
        role: {
          id: member.role.id,
          name: member.role.name,
        },
        attended: attendedBy.get(member.user.id) ?? 0,
        of: lastMeetings.length,
      })),

      soulsWon: raw.soul_won.map((soul: any) => ({
        id: soul.id,
        title: soul.title,
        first_name: soul.first_name,
        last_name: soul.last_name,
        other_name: soul.other_name,
        gender: soul.gender ?? null,
        contact_number: soul.contact_number,
        country_code: soul.country_code ?? null,
        contact_email: soul.contact_email,
        country: soul.country,
        city: soul.city,
        date_won: soul.date_won
          ? soul.date_won.toISOString().split("T")[0]
          : "",
        first_meeting_date: toDateKey(firstMeetingBySoul.get(soul.id)),
        wonById: soul.wonBy.id,
        wonByName: soul.wonBy.name,
        lifeCenterId: id,
        isMember: Boolean(soul.memberId),
        memberId: soul.member?.id ?? null,
        memberName: soul.member?.name ?? "",
        memberMemberId: soul.member?.member_id ?? "",
      })),
    };
  }

  /**
   * Removes the center with its members, meetings and souls-won records in one
   * transaction. Users converted from those souls keep their membership; only
   * the link back to the soul is cleared.
   */
  async deleteLifeCenter(id: number) {
    const existing = await prisma.life_center.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new LifeCenterHttpError(404, "Life center not found");

    return prisma.$transaction(async (tx) => {
      const meetingIds = (
        await tx.life_center_meeting.findMany({
          where: { lifeCenterId: id },
          select: { id: true },
        })
      ).map((m) => m.id);
      const soulIds = (
        await tx.soul_won.findMany({
          where: { lifeCenterId: id },
          select: { id: true },
        })
      ).map((s) => s.id);

      if (meetingIds.length) {
        await tx.life_center_meeting_member.deleteMany({
          where: { meetingId: { in: meetingIds } },
        });
      }
      if (meetingIds.length || soulIds.length) {
        await tx.life_center_meeting_attendee.deleteMany({
          where: {
            OR: [
              ...(meetingIds.length ? [{ meetingId: { in: meetingIds } }] : []),
              ...(soulIds.length ? [{ soulWonId: { in: soulIds } }] : []),
            ],
          },
        });
      }
      await tx.life_center_meeting.deleteMany({ where: { lifeCenterId: id } });

      if (soulIds.length) {
        await tx.user.updateMany({
          where: { source_soul_won_id: { in: soulIds } },
          data: { source_soul_won_id: null },
        });
        await tx.soul_won.updateMany({
          where: { id: { in: soulIds }, memberId: { not: null } },
          data: { memberId: null },
        });
        await tx.soul_won.deleteMany({ where: { id: { in: soulIds } } });
      }

      await tx.life_center_member.deleteMany({ where: { lifeCenterId: id } });
      return tx.life_center.delete({ where: { id } });
    });
  }

  async updateLifeCenter(
    id: number,
    data: {
      name: string;
      description: string;
      meetingLocation: string;
      meetingDays: string;
      branch_id?: number | string | null;
      leaderUserId?: number;
    },
  ) {
    const { branch_id, leaderUserId, ...lifeCenterData } = data;
    if (leaderUserId) {
      await roleEligibilityService.assertEligible(
        "life_center_leader",
        leaderUserId,
      );
    }
    const branchData =
      branch_id !== undefined
        ? { branch_id: await resolveBranchIdOrDefault(branch_id) }
        : {};

    const response = await prisma.$transaction(async (tx) => {
      const center = await tx.life_center.update({
        where: { id },
        data: { ...lifeCenterData, ...branchData },
      });
      if (leaderUserId) {
        await setLeaderTx(tx, id, leaderUserId);
      }
      return center;
    });

    return {
      id: response.id,
      name: response.name,
      description: response.description,
      location: response.meetingLocation,
      meeting_dates: parseMeetingDays(response.meetingDays),
      branch_id: response.branch_id ?? null,
      created_at: toDateKey(response.createdAt),
    };
  }

  async addMemberToLifeCenter(data: {
    userId: number;
    lifeCenterId: number;
    roleId: number;
  }) {
    const role = await resolveTargetRole(data.roleId, data.userId);

    return prisma.$transaction(async (tx) => {
      // Create first so a duplicate (P2002) aborts before anyone is demoted.
      const member = await tx.life_center_member.create({
        data: {
          userId: data.userId,
          lifeCenterId: data.lifeCenterId,
          roleId: role.id,
        },
      });
      if (role.isLeader) {
        await demoteOtherLeaders(tx, data.lifeCenterId, data.userId);
      }
      return member;
    });
  }

  async getMyLifeCenter(userId: number) {
    const member = await prisma.life_center_member.findFirst({
      where: { userId },
      include: {
        lifeCenter: true,
        role: true,
      },
    });

    if (!member) return null;

    const life_center_id = member.lifeCenterId;

    return this.getLifeCenterById(life_center_id);
  }

  async updateMemberRole(data: {
    userId: number;
    lifeCenterId: number;
    roleId: number;
  }) {
    const role = await resolveTargetRole(data.roleId, data.userId);

    return prisma.$transaction(async (tx) => {
      const member = await tx.life_center_member.update({
        where: {
          userId_lifeCenterId: {
            userId: data.userId,
            lifeCenterId: data.lifeCenterId,
          },
        },
        data: { roleId: role.id },
      });
      if (role.isLeader) {
        await demoteOtherLeaders(tx, data.lifeCenterId, data.userId);
      }
      return member;
    });
  }

  async removeMemberFromLifeCenter(data: {
    userId: number;
    lifeCenterId: number;
  }) {
    const member = await prisma.life_center_member.findFirst({
      where: {
        userId: data.userId,
        lifeCenterId: data.lifeCenterId,
      },
    });

    if (!member) {
      throw new Error("Member not found in this Life Center");
    }

    await prisma.life_center_member.delete({
      where: {
        id: member.id,
      },
    });

    return { message: "Member removed successfully" };
  }

  async getAllLifeCenterMembers(lifeCenterId: number) {
    const members = await prisma.life_center_member.findMany({
      where: {
        lifeCenterId,
      },
      include: {
        user: true,
        role: true,
      },
    });

    return members;
  }

  async removeSoul(id: number) {
    const soul = await prisma.soul_won.findUnique({ where: { id } });
    if (!soul) throw new Error("Soul not found");

    await prisma.soul_won.delete({ where: { id } });

    return { message: "Soul removed successfully" };
  }

  async getSouls(filter?: { lifeCenterId?: number; wonById?: number }) {
    return await prisma.soul_won.findMany({
      where: {
        lifeCenterId: filter?.lifeCenterId,
        wonById: filter?.wonById,
      },
      include: {
        wonBy: true,
        lifeCenter: true,
        member: {
          select: {
            id: true,
            name: true,
            email: true,
            member_id: true,
            status: true,
          },
        },
      },
    });
  }

  async getSoul(id: number) {
    const soul = await prisma.soul_won.findUnique({
      where: { id },
      include: {
        wonBy: true,
        lifeCenter: true,
        member: {
          select: {
            id: true,
            name: true,
            email: true,
            member_id: true,
            status: true,
          },
        },
      },
    });

    if (!soul) throw new Error("Soul not found");
    return soul;
  }

  async createSoulWon(data: {
    title: string;
    first_name: string;
    last_name: string;
    other_name?: string;
    gender?: string;
    contact_number: string;
    country_code: string;
    contact_email?: string;
    country: string;
    city: string;
    date_won: Date;
    wonById: number;
    lifeCenterId: number;
  }) {
    return await prisma.soul_won.create({
      data,
    });
  }

  async updateSoulWon(
    id: number,
    data: {
      title?: string;
      first_name?: string;
      last_name?: string;
      other_name?: string;
      gender?: string;
      contact_number?: string;
      country_code?: string;
      contact_email?: string;
      country?: string;
      city?: string;
      date_won?: Date;
      wonById?: number;
      lifeCenterId?: number;
    },
  ) {
    return await prisma.soul_won.update({
      where: { id },
      data: {
        title: data.title,
        first_name: data.first_name,
        last_name: data.last_name,
        other_name: data.other_name,
        gender: data.gender,
        contact_number: data.contact_number,
        country_code: data.country_code,
        contact_email: data.contact_email,
        country: data.country,
        city: data.city,
        date_won: data.date_won,
        wonById: data.wonById,
        lifeCenterId: data.lifeCenterId,
      },
    });
  }

  async getLifeCenterStats() {
    const souls = await prisma.soul_won.findMany({
      include: {
        lifeCenter: {
          select: {
            name: true,
            life_center_member: {
              select: {
                role: { select: { name: true } },
                user: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        wonBy: {
          select: {
            name: true,
          },
        },
      },
    });
    const formatted_output = souls.map((soul) => ({
      life_center_name: soul.lifeCenter?.name,
      leader_name:
        findLeader(soul.lifeCenter?.life_center_member ?? [])?.name ?? "N/A",
      soul_name: `${soul.first_name} ${soul.last_name}`,
      contact: soul.contact_number,
      location: soul.city,
      date_won: soul.date_won,
      won_by: soul.wonBy.name,
    }));

    return formatted_output;
  }

  /**
   * Everything the list page and analytics need in one call. `from`/`to`
   * bound `meetings` and `souls`; center totals are all time.
   */
  async getOverview(params: {
    branchId?: unknown;
    scope?: LifeCenterScope;
    lifeCenterId?: number;
    from?: Date;
    to?: Date;
  }) {
    const { scope, lifeCenterId, from, to } = params;
    if (from && to && from.getTime() > to.getTime()) {
      throw new LifeCenterHttpError(400, "from must not be after to");
    }
    if (lifeCenterId && isMemberScope(scope) && !scope!.lifeCenterIds.includes(lifeCenterId)) {
      throw new LifeCenterHttpError(401, "Not authorized to view life center");
    }

    const idFilter: number[] | undefined = lifeCenterId
      ? [lifeCenterId]
      : isMemberScope(scope)
        ? scope!.lifeCenterIds
        : undefined;

    const centers = await prisma.life_center.findMany({
      where: {
        ...getBranchScopedWhere(params.branchId),
        ...(idFilter ? { id: { in: idFilter } } : {}),
      },
      orderBy: { name: "asc" },
      include: {
        life_center_member: {
          select: {
            roleId: true,
            role: { select: { name: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    const centerIds = centers.map((c) => c.id);

    const [roles, souls, meetingIndex] = await Promise.all([
      prisma.life_center_role.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      centerIds.length
        ? prisma.soul_won.findMany({
            where: { lifeCenterId: { in: centerIds } },
            select: {
              id: true,
              lifeCenterId: true,
              date_won: true,
              memberId: true,
              _count: { select: { converted_members: true } },
            },
            orderBy: { date_won: "asc" },
          })
        : Promise.resolve([]),
      centerIds.length
        ? prisma.life_center_meeting.findMany({
            where: { lifeCenterId: { in: centerIds } },
            select: { id: true, lifeCenterId: true, date: true },
            orderBy: [{ date: "desc" }, { id: "desc" }],
          })
        : Promise.resolve([]),
    ]);

    const inRange = (date: Date) =>
      (!from || date.getTime() >= from.getTime()) &&
      (!to || date.getTime() <= to.getTime());

    // Last 8 per center (index is newest first) plus everything in range.
    const recentByCenter = new Map<number, number[]>();
    const detailIds = new Set<number>();
    for (const meeting of meetingIndex) {
      const list = recentByCenter.get(meeting.lifeCenterId) ?? [];
      if (list.length < RECENT_MEETINGS) {
        list.push(meeting.id);
        recentByCenter.set(meeting.lifeCenterId, list);
        detailIds.add(meeting.id);
      }
      if (inRange(meeting.date)) detailIds.add(meeting.id);
    }

    const details = detailIds.size
      ? await prisma.life_center_meeting.findMany({
          where: { id: { in: Array.from(detailIds) } },
          select: {
            id: true,
            lifeCenterId: true,
            date: true,
            offeringAmount: true,
            currency: true,
            members: { select: { userId: true } },
            attendees: { select: { soulWonId: true } },
          },
          orderBy: [{ date: "asc" }, { id: "asc" }],
        })
      : [];
    const detailById = new Map(details.map((d) => [d.id, d]));

    const isConverted = (soul: (typeof souls)[number]) =>
      Boolean(soul.memberId) || soul._count.converted_members > 0;

    const roleCounts = new Map<number, number>();
    for (const center of centers) {
      for (const member of center.life_center_member) {
        roleCounts.set(member.roleId, (roleCounts.get(member.roleId) ?? 0) + 1);
      }
    }

    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        member_count: roleCounts.get(role.id) ?? 0,
      })),
      centers: centers.map((center) => {
        const centerSouls = souls.filter((s) => s.lifeCenterId === center.id);
        const recent = (recentByCenter.get(center.id) ?? [])
          .map((id) => detailById.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m));
        return {
          id: center.id,
          name: center.name,
          description: center.description,
          location: center.meetingLocation,
          meeting_days: parseMeetingDays(center.meetingDays),
          created_at: toDateKey(center.createdAt) as string,
          leader: findLeader(center.life_center_member),
          member_count: center.life_center_member.length,
          souls_total: centerSouls.length,
          souls_to_follow_up: centerSouls.filter((s) => !isConverted(s)).length,
          last_meeting_date: recent.length ? toDateKey(recent[0].date) : null,
          recent_meetings: recent.map((m) => ({
            date: toDateKey(m.date) as string,
            members: m.members.length,
            first_timers: m.attendees.length,
          })),
        };
      }),
      meetings: details
        .filter((m) => inRange(m.date))
        .map((m) => ({
          id: m.id,
          life_center_id: m.lifeCenterId,
          date: toDateKey(m.date) as string,
          member_user_ids: m.members.map((row) => row.userId),
          first_timer_ids: m.attendees.map((row) => row.soulWonId),
          offering: Number(m.offeringAmount ?? 0),
          currency: m.currency,
        })),
      souls: souls
        .filter((s) => inRange(s.date_won))
        .map((s) => ({
          id: s.id,
          life_center_id: s.lifeCenterId,
          date_won: toDateKey(s.date_won) as string,
          converted: isConverted(s),
        })),
    };
  }

  /**
   * Asks the center's leader to record or check on meetings. One reminder per
   * center per 24h: the slot is claimed atomically and released if the send
   * fails.
   */
  async remindLeader(
    lifeCenterId: number,
    reason: LeaderReminderReason,
    actorUserId?: number,
  ) {
    const center = await prisma.life_center.findUnique({
      where: { id: lifeCenterId },
      select: {
        id: true,
        name: true,
        lastRemindedAt: true,
        life_center_member: {
          select: {
            role: { select: { name: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!center) throw new LifeCenterHttpError(404, "Life center not found");

    const leader = findLeader(center.life_center_member);
    if (!leader) {
      throw new LifeCenterHttpError(400, "This life center has no leader to remind.");
    }

    const cooldownMessage = "A reminder was already sent to this leader today.";
    if (isReminderOnCooldown(center.lastRemindedAt)) {
      throw new LifeCenterHttpError(429, cooldownMessage);
    }

    const now = new Date();
    const claimed = await prisma.life_center.updateMany({
      where: {
        id: lifeCenterId,
        OR: [
          { lastRemindedAt: null },
          { lastRemindedAt: { lt: new Date(now.getTime() - REMIND_LEADER_COOLDOWN_MS) } },
        ],
      },
      data: { lastRemindedAt: now },
    });
    if (claimed.count === 0) throw new LifeCenterHttpError(429, cooldownMessage);

    const copy = leaderReminderCopy(reason, center.name);
    try {
      await notificationService.createInAppNotification({
        type: "life_center.leader_reminder",
        title: copy.title,
        body: copy.body,
        recipientUserId: leader.user_id,
        actorUserId: actorUserId ?? null,
        entityType: "life_center",
        entityId: String(center.id),
        actionUrl: "/member/life-center",
        priority: "MEDIUM",
      });
    } catch (error) {
      await prisma.life_center.update({
        where: { id: lifeCenterId },
        data: { lastRemindedAt: center.lastRemindedAt },
      });
      throw error;
    }

    return { sent_to: leader.name };
  }
}
