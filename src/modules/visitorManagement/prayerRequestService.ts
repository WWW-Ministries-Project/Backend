import { prisma } from "../../Models/context";

const toPositiveInt = (value: any) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseResponsibleMembers = (responsibleMembers: any): number[] => {
  if (!Array.isArray(responsibleMembers)) {
    return [];
  }

  const ids = responsibleMembers
    .map((memberId) => toPositiveInt(memberId))
    .filter((memberId): memberId is number => Boolean(memberId));

  return Array.from(new Set(ids));
};

export class PrayerRequestService {
  async createPrayerRequest(data: any) {
    return await prisma.prayer_request.create({ data });
  }

  async getAllPrayerRequests(scope?: {
    mode?: "all" | "responsible";
    memberId?: number;
  }) {
    const shouldScopeByResponsibleMember =
      scope?.mode === "responsible" &&
      Number.isInteger(Number(scope?.memberId)) &&
      Number(scope?.memberId) > 0;
    const scopedResponsibleMemberId = shouldScopeByResponsibleMember
      ? Number(scope?.memberId)
      : null;

    const prayerRequests = await prisma.prayer_request.findMany({
      include: {
        visitor: {
          select: {
            responsibleMembers: true,
          },
        },
      },
    });

    const filteredPrayerRequests = shouldScopeByResponsibleMember
      ? prayerRequests.filter((prayerRequest) =>
          parseResponsibleMembers(
            prayerRequest.visitor?.responsibleMembers,
          ).includes(scopedResponsibleMemberId as number),
        )
      : prayerRequests;

    return filteredPrayerRequests.map(({ visitor, ...prayerRequest }) => prayerRequest);
  }

  async getPrayerRequestById(id: any) {
    return await prisma.prayer_request.findUnique({ where: { id } });
  }

  async updatePrayerRequest(id: number, data: any) {
    return await prisma.prayer_request.update({ where: { id }, data });
  }

  // Member-facing: a signed-in member's own prayer requests (userId-owned,
  // never visitor-owned), newest first.
  async getPrayerRequestsForUser(userId: number) {
    return await prisma.prayer_request.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      select: { id: true, date: true, request: true, status: true, createdAt: true, updatedAt: true },
    });
  }

  async createPrayerRequestForUser(userId: number, request: string) {
    return await prisma.prayer_request.create({
      data: { userId, request, date: new Date() },
      select: { id: true, date: true, request: true, status: true, createdAt: true, updatedAt: true },
    });
  }

  async deletePrayerRequest(id: number) {
    return await prisma.prayer_request.delete({ where: { id } });
  }
}
