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

    const visits = await prisma.visit.findMany({
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
