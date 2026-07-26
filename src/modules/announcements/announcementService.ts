import { Prisma, announcement_audience } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { notificationService } from "../notifications/notificationService";

export type CreateAnnouncementInput = {
  title: string;
  content: string;
  audience_type: announcement_audience;
  department_id?: number | null;
  position_id?: number | null;
  branch_id?: number | null;
  created_by: number;
};

export type UpdateAnnouncementInput = {
  title?: string;
  content?: string;
  audience_type?: announcement_audience;
  department_id?: number | null;
  position_id?: number | null;
};

type RecipientAnnouncement = {
  audience_type: announcement_audience;
  department_id: number | null;
  position_id: number | null;
  branch_id: number | null;
};

const announcementInclude: Prisma.announcementInclude = {
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
};

const httpError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const distinctIds = (ids: (number | null | undefined)[]): number[] =>
  Array.from(
    new Set(
      ids.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
      ),
    ),
  );

const buildPreview = (content: string): string => {
  const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const validateAudience = (
  audienceType: announcement_audience,
  departmentId?: number | null,
  positionId?: number | null,
) => {
  if (audienceType === "SPECIFIC_DEPARTMENT" && !departmentId) {
    throw httpError(
      "department_id is required for a SPECIFIC_DEPARTMENT audience",
      400,
    );
  }
  if (audienceType === "SPECIFIC_POSITION" && !positionId) {
    throw httpError(
      "position_id is required for a SPECIFIC_POSITION audience",
      400,
    );
  }
};

const createAnnouncement = async (input: CreateAnnouncementInput) => {
  validateAudience(input.audience_type, input.department_id, input.position_id);
  const branchId = await resolveBranchIdOrDefault(input.branch_id);

  return prisma.announcement.create({
    data: {
      title: input.title,
      content: input.content,
      audience_type: input.audience_type,
      department_id:
        input.audience_type === "SPECIFIC_DEPARTMENT"
          ? input.department_id ?? null
          : null,
      position_id:
        input.audience_type === "SPECIFIC_POSITION"
          ? input.position_id ?? null
          : null,
      status: "DRAFT",
      branch_id: branchId,
      created_by: input.created_by,
    },
    include: announcementInclude,
  });
};

const listAnnouncements = async (
  branchId: unknown,
  skip = 0,
  take = 20,
) => {
  const where: Prisma.announcementWhereInput = {
    ...(getBranchScopedWhere(branchId) ?? {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.announcement.findMany({
      where,
      include: announcementInclude,
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    prisma.announcement.count({ where }),
  ]);

  return { data, total };
};

const getAnnouncement = async (id: number) =>
  prisma.announcement.findUnique({
    where: { id },
    include: announcementInclude,
  });

const deleteAnnouncement = async (id: number) =>
  prisma.announcement.delete({ where: { id } });

const updateAnnouncement = async (id: number, input: UpdateAnnouncementInput) => {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Announcement not found", 404);
  }

  // Once published the audience is frozen; only the copy may be edited.
  if (existing.status === "PUBLISHED") {
    return prisma.announcement.update({
      where: { id },
      data: {
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
      },
      include: announcementInclude,
    });
  }

  const audienceType = input.audience_type ?? existing.audience_type;
  const departmentId =
    input.department_id !== undefined ? input.department_id : existing.department_id;
  const positionId =
    input.position_id !== undefined ? input.position_id : existing.position_id;

  validateAudience(audienceType, departmentId, positionId);

  return prisma.announcement.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      content: input.content ?? existing.content,
      audience_type: audienceType,
      department_id:
        audienceType === "SPECIFIC_DEPARTMENT" ? departmentId ?? null : null,
      position_id:
        audienceType === "SPECIFIC_POSITION" ? positionId ?? null : null,
    },
    include: announcementInclude,
  });
};

const resolveRecipients = async (
  announcement: RecipientAnnouncement,
): Promise<number[]> => {
  const branchWhere = getBranchScopedWhere(announcement.branch_id);
  const userBranchWhere = branchWhere ?? {};

  switch (announcement.audience_type) {
    case "ALL_MEMBERS": {
      const users = await prisma.user.findMany({
        where: { ...userBranchWhere },
        select: { id: true },
      });
      return distinctIds(users.map((user) => user.id));
    }

    case "MINISTRY_WORKERS": {
      const users = await prisma.user.findMany({
        where: { is_user: true, ...userBranchWhere },
        select: { id: true },
      });
      return distinctIds(users.map((user) => user.id));
    }

    case "HEADS_OF_DEPARTMENT": {
      const departments = await prisma.department.findMany({
        where: { department_head: { not: null }, ...(branchWhere ?? {}) },
        select: { department_head: true },
      });
      return distinctIds(departments.map((dept) => dept.department_head));
    }

    case "SPECIFIC_DEPARTMENT": {
      if (!announcement.department_id) return [];
      const [positions, memberships] = await Promise.all([
        prisma.department_positions.findMany({
          where: { department_id: announcement.department_id },
          select: { user_id: true },
        }),
        prisma.user_departments.findMany({
          where: { department_id: announcement.department_id },
          select: { user_id: true },
        }),
      ]);

      const candidateIds = distinctIds([
        ...positions.map((row) => row.user_id),
        ...memberships.map((row) => row.user_id),
      ]);
      if (!candidateIds.length) return [];

      const users = await prisma.user.findMany({
        where: { id: { in: candidateIds }, ...userBranchWhere },
        select: { id: true },
      });
      return distinctIds(users.map((user) => user.id));
    }

    case "SPECIFIC_POSITION": {
      if (!announcement.position_id) return [];
      const [directUsers, positionRows] = await Promise.all([
        prisma.user.findMany({
          where: { position_id: announcement.position_id, ...userBranchWhere },
          select: { id: true },
        }),
        prisma.department_positions.findMany({
          where: { position_id: announcement.position_id },
          select: { user_id: true },
        }),
      ]);

      const positionUserIds = distinctIds(positionRows.map((row) => row.user_id));
      let scopedPositionUsers: { id: number }[] = [];
      if (positionUserIds.length) {
        scopedPositionUsers = await prisma.user.findMany({
          where: { id: { in: positionUserIds }, ...userBranchWhere },
          select: { id: true },
        });
      }

      return distinctIds([
        ...directUsers.map((user) => user.id),
        ...scopedPositionUsers.map((user) => user.id),
      ]);
    }

    default:
      return [];
  }
};

const publishAnnouncement = async (id: number, actorUserId?: number) => {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Announcement not found", 404);
  }
  if (existing.status === "PUBLISHED") {
    throw httpError("Announcement is already published", 409);
  }

  const published = await prisma.announcement.update({
    where: { id },
    data: { status: "PUBLISHED", published_at: new Date() },
    include: announcementInclude,
  });

  const recipientIds = await resolveRecipients(published);

  if (recipientIds.length) {
    await notificationService.createManyInAppNotifications(
      recipientIds.map((recipientUserId) => ({
        type: "announcement.published",
        title: published.title,
        body: buildPreview(published.content),
        recipientUserId,
        actorUserId:
          actorUserId && actorUserId > 0 ? actorUserId : published.created_by,
        entityType: "ANNOUNCEMENT",
        entityId: String(published.id),
        actionUrl: "/announcements",
        priority: "MEDIUM",
        dedupeKey: `announcement:${published.id}:recipient:${recipientUserId}`,
      })),
    );
  }

  return { announcement: published, recipientCount: recipientIds.length };
};

const listForUser = async (userId: number, skip = 0, take = 20) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, is_user: true, position_id: true, branch_id: true },
  });

  if (!user) {
    return { data: [], total: 0 };
  }

  const [headedDepartments, positionRows, membershipRows] = await Promise.all([
    prisma.department.findMany({
      where: { department_head: userId },
      select: { id: true },
    }),
    prisma.department_positions.findMany({
      where: { user_id: userId },
      select: { department_id: true },
    }),
    prisma.user_departments.findMany({
      where: { user_id: userId },
      select: { department_id: true },
    }),
  ]);

  const departmentIds = distinctIds([
    ...positionRows.map((row) => row.department_id),
    ...membershipRows.map((row) => row.department_id),
  ]);

  const or: Prisma.announcementWhereInput[] = [
    { audience_type: "ALL_MEMBERS" },
  ];
  if (user.is_user) {
    or.push({ audience_type: "MINISTRY_WORKERS" });
  }
  if (headedDepartments.length) {
    or.push({ audience_type: "HEADS_OF_DEPARTMENT" });
  }
  if (departmentIds.length) {
    or.push({
      audience_type: "SPECIFIC_DEPARTMENT",
      department_id: { in: departmentIds },
    });
  }
  if (user.position_id) {
    or.push({
      audience_type: "SPECIFIC_POSITION",
      position_id: user.position_id,
    });
  }

  // Only show announcements from the user's branch or global (unscoped) ones.
  const branchFilter: Prisma.announcementWhereInput = {
    OR: [{ branch_id: user.branch_id }, { branch_id: null }],
  };

  const where: Prisma.announcementWhereInput = {
    AND: [{ status: "PUBLISHED" }, { OR: or }, branchFilter],
  };

  const [data, total] = await prisma.$transaction([
    prisma.announcement.findMany({
      where,
      include: announcementInclude,
      orderBy: { published_at: "desc" },
      skip,
      take,
    }),
    prisma.announcement.count({ where }),
  ]);

  return { data, total };
};

export const announcementService = {
  createAnnouncement,
  listAnnouncements,
  getAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  resolveRecipients,
  listForUser,
};
