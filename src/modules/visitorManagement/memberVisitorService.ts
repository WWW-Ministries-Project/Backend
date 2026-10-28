import { prisma } from "../../Models/context";
import { parseResponsibleMemberIds } from "./visitorAccess";

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

// pending is the schema default; the rest are the terminal values
// followUpNotificationCron excludes. The admin /followup path does not validate.
export const MEMBER_FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled", "done"];
export const MAX_NOTE_LENGTH = 2000;

export class MemberVisitorService {
  async getVisitorsForResponsibleUser(userId: number) {
    // `contains` is a loose prefilter; the parse is the exact membership check.
    const visitors = await prisma.visitor.findMany({
      where: { responsibleMembers: { contains: String(userId) } },
      orderBy: { visitDate: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        visitDate: true,
        is_member: true,
        responsibleMembers: true,
      },
    });
    return visitors
      .filter((v) => parseResponsibleMemberIds(v.responsibleMembers).includes(userId))
      .map(({ responsibleMembers: _rm, ...rest }) => rest);
  }

  async getFollowUpsForAssignee(userId: number, visitorId?: number) {
    return prisma.follow_up.findMany({
      where: { assignedTo: userId, ...(visitorId ? { visitorId } : {}) },
      orderBy: { date: "asc" },
    });
  }

  async updateOwnFollowUp(
    userId: number,
    followUpId: number,
    data: { status?: string; notes?: string },
  ) {
    if (data.status !== undefined && !MEMBER_FOLLOW_UP_STATUSES.includes(data.status)) {
      throw httpError(`Invalid status. Allowed: ${MEMBER_FOLLOW_UP_STATUSES.join(", ")}`, 400);
    }
    if (data.notes !== undefined && data.notes.length > MAX_NOTE_LENGTH) {
      throw httpError(`Notes must be ${MAX_NOTE_LENGTH} characters or fewer`, 400);
    }
    const followUp = await prisma.follow_up.findUnique({
      where: { id: followUpId },
    });
    if (!followUp) throw httpError("Follow-up not found", 404);
    if (followUp.assignedTo !== userId) {
      throw httpError("Not authorized to update this follow-up", 403);
    }
    return prisma.follow_up.update({
      where: { id: followUpId },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
  }

  async addVisitNoteForResponsibleUser(
    userId: number,
    visitorId: number,
    content: string,
  ) {
    if (content.length > MAX_NOTE_LENGTH) {
      throw httpError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer`, 400);
    }
    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      select: { responsibleMembers: true },
    });
    if (!visitor) throw httpError("Visitor not found", 404);
    if (!parseResponsibleMemberIds(visitor.responsibleMembers).includes(userId)) {
      throw httpError("Not authorized for this visitor", 403);
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return prisma.note.create({
      data: {
        visitorId,
        userId,
        date: new Date(),
        author: user?.name || "Unknown",
        content,
      },
    });
  }
}
