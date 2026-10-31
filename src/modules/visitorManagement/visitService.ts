import { prisma } from "../../Models/context";
import { getBranchScopedWhere } from "../branches/branchService";
import { parseResponsibleMemberIds } from "./visitorAccess";

// `responsibleMembers` is stored as a JSON string; an array-only parser
// matched nobody, so responsible members saw empty lists.
const parseResponsibleMembers = parseResponsibleMemberIds;

export class VisitService {
  async getVisitByVisitorId(id: number) {
    return prisma.visit.findMany({ where: { visitorId: id } });
  }

  async createVisit(data: {
    visitorId: number;
    date: Date;
    eventId: number | null;
    notes?: string;
  }) {
    return prisma.visit.create({ data });
  }

  async getAllVisits(scope?: { mode?: "all" | "responsible"; memberId?: number }) {
    const shouldScopeByResponsibleMember =
      scope?.mode === "responsible" &&
      Number.isInteger(Number(scope?.memberId)) &&
      Number(scope?.memberId) > 0;
    const scopedResponsibleMemberId = shouldScopeByResponsibleMember
      ? Number(scope?.memberId)
      : null;

    const branchWhere = getBranchScopedWhere(undefined);
    const visits = await prisma.visit.findMany({
      ...(branchWhere ? { where: { visitor: branchWhere } } : {}),
      include: {
        visitor: {
          select: {
            responsibleMembers: true,
          },
        },
      },
    });

    const filteredVisits = shouldScopeByResponsibleMember
      ? visits.filter((visit) =>
          parseResponsibleMembers(visit.visitor?.responsibleMembers).includes(
            scopedResponsibleMemberId as number,
          ),
        )
      : visits;

    return filteredVisits.map(({ visitor, ...visit }) => visit);
  }

  async getVisitById(id: number) {
    return prisma.visit.findUnique({ where: { id } });
  }

  async updateVisit(
    id: number,
    data: { visitorId: number; date: Date; eventId: number; notes?: string },
  ) {
    return prisma.visit.update({ where: { id }, data });
  }

  async deleteVisit(id: number) {
    return prisma.visit.delete({ where: { id } });
  }
}
