import { prisma } from "../../Models/context";
import { getBranchScopedWhere } from "../branches/branchService";
import { parseResponsibleMemberIds } from "./visitorAccess";

// `responsibleMembers` is stored as a JSON string; an array-only parser
// matched nobody, so responsible members saw empty lists.
const parseResponsibleMembers = parseResponsibleMemberIds;

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

    // Visitor requests by the visitor's branch; members' own by the member's.
    const branchWhere = getBranchScopedWhere(undefined);
    const prayerRequests = await prisma.prayer_request.findMany({
      ...(branchWhere
        ? {
            where: {
              OR: [
                { visitor: branchWhere },
                { visitorId: null, user: branchWhere },
              ],
            },
          }
        : {}),
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
