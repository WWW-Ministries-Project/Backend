import { tr } from "date-fns/locale";
import { prisma } from "../../Models/context";

export class LifeCenterService {
  /**
   * Create a new LifeCenter
   */
  async create(data: {
    name: string;
    description: string;
    meetingLocation: string;
    meetingDays: string;
  }) {
    const response = await prisma.life_center.create({
      data: {
        name: data.name,
        description: data.description,
        meetingLocation: data.meetingLocation,
        meetingDays: data.meetingDays,
      },
    });

    if (response) {
      const response_data = {
        id: response.id,
        name: response.name,
        description: response.description,
        location: response.meetingLocation,
        meeting_dates: response.meetingDays.split(","),
      };
      return response_data;
    }

    return null;
  }

  async getAllLifeCenters() {
    const results = await prisma.life_center.findMany({
      orderBy: {
        name: "desc",
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
      };
    });
  }

  async getLifeCenterById(id: number) {
    const raw = await prisma.life_center.findUnique({
      where: { id },
      include: {
        life_center_member: {
          select: {
            role: {
              select: { id: true, name: true },
            },
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        soul_won: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            contact_email: true,
            city: true,
            date_won: true,
            country: true,
            other_name:true,
            contact_number:true,
            wonBy: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!raw) return null;

    // Structure the response
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      location: raw.meetingLocation,
      meeting_dates: raw.meetingDays.split(",").map((day) => day.trim()),

      members: raw.life_center_member.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: {
          id: member.role.id,
          name: member.role.name,
        },
      })),

      soulsWon: raw.soul_won.map((soul) => ({
        id: soul.id,
        first_name: soul.first_name,
        last_name: soul.last_name,
        other_name:soul.other_name,
        contact_number: soul.contact_number,
        contact_email: soul.contact_email,
        country: soul.country,
        city: soul.city,
        date_won: soul.date_won ? soul.date_won.toISOString().split("T")[0] : "",
        wonById:soul.wonBy.id,
        wonByName:soul.wonBy.name,
        lifeCenterId:id
      })),
    };
  }

  async deleteLifeCenter(id: number) {
    return await prisma.life_center.delete({
      where: { id },
    });
  }

  async updateLifeCenter(
    id: number,
    data: {
      name: string;
      description: string;
      meetingLocation: string;
      meetingDays: string;
    },
  ) {
    const response = await prisma.life_center.update({
      where: { id },
      data,
    });

    return {
      name: response.name,
      description: response.description,
      location: response.meetingLocation,
      meeting_dates: response.meetingDays.split(",").map((day) => day.trim()),
    };
  }

  async addMemberToLifeCenter(data: {
    userId: number;
    lifeCenterId: number;
    roleId: number;
  }) {
    const member = await prisma.life_center_member.create({
      data: {
        userId: data.userId,
        lifeCenterId: data.lifeCenterId,
        roleId: data.roleId,
      },
    });

    return member;
  }

  async updateMemberRole(data: {
    userId: number;
    lifeCenterId: number;
    roleId: number;
  }) {
    const member = await prisma.life_center_member.update({
      where: {
        userId_lifeCenterId: {
          userId: data.userId,
          lifeCenterId: data.lifeCenterId,
        },
      },
      data: {
        roleId: data.roleId,
      },
    });

    return member;
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
      },
    });
  }

  async getSoul(id: number) {
    const soul = await prisma.soul_won.findUnique({
      where: { id },
      include: {
        wonBy: true,
        lifeCenter: true,
      },
    });

    if (!soul) throw new Error("Soul not found");
    return soul;
  }

  async createSoulWon(data: {
    first_name: string;
    last_name: string;
    other_name?: string;
    contact_number: string;
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
      first_name?: string;
      last_name?: string;
      other_name?: string;
      contact_number?: string;
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
      data:{
        first_name: data.first_name,
      last_name: data.last_name,
      other_name: data.other_name,
      contact_number: data.contact_number,
      contact_email: data.contact_email,
      country: data.country,
      city: data.city,
      date_won: data.date_won,
      wonById: data.wonById,
      lifeCenterId: data.lifeCenterId
      },
    });
  }
}
