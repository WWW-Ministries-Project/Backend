import { prisma } from "../../Models/context";
import { notificationService } from "../notifications/notificationService";

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

export class FollowUpService {
  async createFollowUp(data: any) {
    const followUpData = {
      visitorId: data.visitorId,
      date: new Date(data.date),
      type: data.type,
      status: data.status || "pending",
      notes: data.notes,
      assignedTo: data.assignedTo,
    };
    const createdFollowUp = await prisma.follow_up.create({ data: followUpData });

    if (
      Number.isInteger(Number(createdFollowUp.assignedTo)) &&
      Number(createdFollowUp.assignedTo) > 0
    ) {
      await notificationService.createInAppNotification({
        type: "follow_up.assigned",
        title: "New follow-up assignment",
        body: "A visitor follow-up has been assigned to you.",
        recipientUserId: Number(createdFollowUp.assignedTo),
        actorUserId: toPositiveInt(data.userId),
        entityType: "VISITOR_FOLLOW_UP",
        entityId: String(createdFollowUp.id),
        actionUrl: `/home/visitors/visitor/${createdFollowUp.visitorId}`,
        priority: "MEDIUM",
        dedupeKey: `follow-up:${createdFollowUp.id}:assigned:${createdFollowUp.assignedTo}`,
      });
    }

    return createdFollowUp;
  }

  async getAllFollowUps(scope?: {
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

    const followUps = await prisma.follow_up.findMany({
      include: {
        visitor: {
          select: {
            responsibleMembers: true,
          },
        },
      },
    });

    const filteredFollowUps = shouldScopeByResponsibleMember
      ? followUps.filter((followUp) =>
          parseResponsibleMembers(followUp.visitor?.responsibleMembers).includes(
            scopedResponsibleMemberId as number,
          ),
        )
      : followUps;

    return filteredFollowUps.map(({ visitor, ...followUp }) => followUp);
  }

  async getFollowUpById(id: number) {
    let assigned_to: number | null = null;
    let user = null;

    const followup = await prisma.follow_up.findUnique({ where: { id } });

    if (!followup) return null;
    if (followup.assignedTo) {
      const userData = await prisma.user.findUnique({
        where: { id: followup.assignedTo },
        select: {
          id: true,
          name: true,
          user_info: {
            select: {
              first_name: true,
              last_name: true,
            },
          },
        },
      });
      if (userData) {
        user = {
          id: userData.id,
          name: userData.name,
          first_name: userData.user_info?.first_name || null,
          last_name: userData.user_info?.last_name || null,
        };
      }
    }

    return { followup, assignedTo: user };
  }

  async updateFollowUp(id: number, data: any, actorUserId?: number | null) {
    const existing = await prisma.follow_up.findUnique({
      where: { id },
      select: { assignedTo: true, visitorId: true },
    });

    const followUpData = {
      visitorId: data.visitorId,
      date: new Date(data.date),
      type: data.type,
      status: data.status || "pending",
      notes: data.notes,
      assignedTo: data.assignedTo,
    };
    const updated = await prisma.follow_up.update({ where: { id }, data: followUpData });

    const previousAssignee = toPositiveInt(existing?.assignedTo);
    const newAssignee = toPositiveInt(updated.assignedTo);
    if (newAssignee && newAssignee !== previousAssignee) {
      await notificationService.createInAppNotification({
        type: "follow_up.assigned",
        title: "New follow-up assignment",
        body: "A visitor follow-up has been assigned to you.",
        recipientUserId: newAssignee,
        actorUserId: toPositiveInt(actorUserId),
        entityType: "VISITOR_FOLLOW_UP",
        entityId: String(updated.id),
        actionUrl: `/home/visitors/visitor/${updated.visitorId}`,
        priority: "MEDIUM",
        dedupeKey: `follow-up:${updated.id}:assigned:${newAssignee}`,
      });
    }

    return updated;
  }

  async deleteFollowUp(id: number) {
    return await prisma.follow_up.delete({ where: { id } });
  }
}
