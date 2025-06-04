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
    const results = await prisma.life_center.findMany({});

    return results.map((response) => {
      return {
        id: response.id,
        name: response.name,
        description: response.description,
        location: response.meetingLocation,
        meeting_dates: response.meetingDays.split(",").map((day) => day.trim()),
      };
    });
  }

  async getLifeCenterById(id: number) {
    const response = await prisma.life_center.findUnique({
      where: { id },
    });

    if (!response) return null;

    return {
      name: response.name,
      description: response.description,
      location: response.meetingLocation,
      meeting_dates: response.meetingDays.split(",").map((day) => day.trim()),
    };
  }

  async deleteLifeCenter(id: number) {
    return await prisma.life_center.delete({
      where: { id },
    });
  }

  /**
   * Update an existing LifeCenter by ID
   */
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

  /**
   * Add a member to the life centers
   */

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
      where: {},
    });
  }
}
