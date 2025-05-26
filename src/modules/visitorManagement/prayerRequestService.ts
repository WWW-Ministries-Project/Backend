import { prisma } from "../../Models/context";

export class PrayerRequestService {
  async createPrayerRequest(data: any) {
    return await prisma.prayer_request.create({ data });
  }

  async getAllPrayerRequests() {
    return await prisma.prayer_request.findMany();
  }

  async getPrayerRequestById(id: any) {
    return await prisma.prayer_request.findUnique({ where: { id } });
  }

  async updatePrayerRequest(id: number, data: any) {
    return await prisma.prayer_request.update({ where: { id }, data });
  }

  async deletePrayerRequest(id: number) {
    return await prisma.prayer_request.delete({ where: { id } });
  }
}
