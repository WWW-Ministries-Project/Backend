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
  image_url?: string | null;
  cta_label?: string | null;
  deep_link?: string | null;
  sort_order?: number | null;
  is_promoted?: boolean;
  start_date?: Date | null;
  end_date?: Date | null;
};

export type UpdateAnnouncementInput = {
  title?: string;
  content?: string;
  audience_type?: announcement_audience;
  department_id?: number | null;
  position_id?: number | null;
  image_url?: string | null;
  cta_label?: string | null;
  deep_link?: string | null;
  sort_order?: number | null;
  is_promoted?: boolean;
  start_date?: Date | null;
  end_date?: Date | null;
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
      image_url: input.image_url ?? null,
      cta_label: input.cta_label ?? null,
      deep_link: input.deep_link ?? null,
      sort_order: input.sort_order ?? null,
      is_promoted: input.is_promoted ?? false,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
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

  // Promotion metadata (image/CTA/deep-link/order/window) is display-only —
  // it stays editable after publish. Only audience/department/position stay
  // frozen once real recipients have already been resolved against them.
  const promoFields = {
    image_url: input.image_url !== undefined ? input.image_url : existing.image_url,
    cta_label: input.cta_label !== undefined ? input.cta_label : existing.cta_label,
    deep_link: input.deep_link !== undefined ? input.deep_link : existing.deep_link,
    sort_order: input.sort_order !== undefined ? input.sort_order : existing.sort_order,
    is_promoted: input.is_promoted !== undefined ? input.is_promoted : existing.is_promoted,
    start_date: input.start_date !== undefined ? input.start_date : existing.start_date,
    end_date: input.end_date !== undefined ? input.end_date : existing.end_date,
  };

  // Once published the audience is frozen; only the copy (and promo fields) may be edited.
  if (existing.status === "PUBLISHED") {
    return prisma.announcement.update({
      where: { id },
      data: {
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        ...promoFields,
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
      ...promoFields,
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
        actionUrl: "/member/announcements",
        priority: "MEDIUM",
        dedupeKey: `announcement:${published.id}:recipient:${recipientUserId}`,
      })),
    );
  }

  return { announcement: published, recipientCount: recipientIds.length };
};

// Shared by listForUser and getUnreadCountForUser so the audience-targeting
// rules only live in one place. Returns null when the user doesn't exist.
const buildVisibleAnnouncementsWhere = async (
  userId: number,
): Promise<Prisma.announcementWhereInput | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, is_user: true, position_id: true, branch_id: true },
  });

  if (!user) {
    return null;
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

  return { AND: [{ status: "PUBLISHED" }, { OR: or }, branchFilter] };
};

const listForUser = async (userId: number, skip = 0, take = 20) => {
  const where = await buildVisibleAnnouncementsWhere(userId);
  if (!where) {
    return { data: [], total: 0 };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.announcement.findMany({
      where,
      include: {
        ...announcementInclude,
        read_receipts: { where: { user_id: userId }, select: { id: true } },
      },
      orderBy: { published_at: "desc" },
      skip,
      take,
    }),
    prisma.announcement.count({ where }),
  ]);

  const data = rows.map(({ read_receipts, ...announcement }) => ({
    ...announcement,
    isRead: read_receipts.length > 0,
  }));

  return { data, total };
};

const getUnreadCountForUser = async (userId: number): Promise<number> => {
  const where = await buildVisibleAnnouncementsWhere(userId);
  if (!where) {
    return 0;
  }

  return prisma.announcement.count({
    where: { ...where, read_receipts: { none: { user_id: userId } } },
  });
};

const markAnnouncementAsRead = async (userId: number, announcementId: number) => {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError("Announcement not found", 404);
  }

  return prisma.announcement_read_receipt.upsert({
    where: {
      announcement_id_user_id: {
        announcement_id: announcementId,
        user_id: userId,
      },
    },
    update: { read_at: new Date() },
    create: { announcement_id: announcementId, user_id: userId },
  });
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
  getUnreadCountForUser,
  markAnnouncementAsRead,
};
