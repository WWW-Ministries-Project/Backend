import { Prisma, promotion_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";

export type CreatePromotionInput = {
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  deep_link?: string | null;
  sort_order?: number | null;
  start_date?: Date | null;
  end_date?: Date | null;
  branch_id?: number | null;
  created_by: number;
};

export type UpdatePromotionInput = {
  title?: string;
  subtitle?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  deep_link?: string | null;
  sort_order?: number | null;
  start_date?: Date | null;
  end_date?: Date | null;
};

/** Server-side cap on `/promotions/active` so the client never has to know
 *  how many slides the carousel can hold. */
const DEFAULT_ACTIVE_LIMIT = 3;
const MAX_ACTIVE_LIMIT = 10;
/** Upper bound on rows pulled before the in-memory `sort_order` pass. Well
 *  above any plausible number of simultaneously-live banners. */
const ACTIVE_SCAN_LIMIT = 100;

const promotionInclude: Prisma.promotionInclude = {
  branch: { select: { id: true, name: true } },
};

const httpError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const validateWindow = (
  startDate?: Date | null,
  endDate?: Date | null,
) => {
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw httpError("start_date must be on or before end_date", 400);
  }
};

const createPromotion = async (input: CreatePromotionInput) => {
  validateWindow(input.start_date, input.end_date);
  const branchId = await resolveBranchIdOrDefault(input.branch_id);

  return prisma.promotion.create({
    data: {
      title: input.title,
      subtitle: input.subtitle ?? null,
      image_url: input.image_url ?? null,
      cta_label: input.cta_label ?? null,
      deep_link: input.deep_link ?? null,
      sort_order: input.sort_order ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      status: "DRAFT",
      branch_id: branchId,
      created_by: input.created_by,
    },
    include: promotionInclude,
  });
};

const listPromotions = async (
  branchId: unknown,
  status?: promotion_status,
  skip = 0,
  take = 20,
) => {
  const where: Prisma.promotionWhereInput = {
    ...(getBranchScopedWhere(branchId) ?? {}),
    ...(status ? { status } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.promotion.findMany({
      where,
      include: promotionInclude,
      // Draft/scheduled banners an admin is still arranging should sit next to
      // each other in the order they will actually render, so sort_order leads
      // and recency only breaks ties.
      orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
      skip,
      take,
    }),
    prisma.promotion.count({ where }),
  ]);

  return { data, total };
};

const getPromotion = async (id: number) =>
  prisma.promotion.findUnique({ where: { id }, include: promotionInclude });

const deletePromotion = async (id: number) =>
  prisma.promotion.delete({ where: { id } });

const updatePromotion = async (id: number, input: UpdatePromotionInput) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Promotion not found", 404);
  }

  const startDate =
    input.start_date !== undefined ? input.start_date : existing.start_date;
  const endDate =
    input.end_date !== undefined ? input.end_date : existing.end_date;
  validateWindow(startDate, endDate);

  // A promotion is display-only, so every field stays editable in every
  // status — unlike an announcement, whose audience freezes once recipients
  // have been resolved against it.
  return prisma.promotion.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      subtitle: input.subtitle !== undefined ? input.subtitle : existing.subtitle,
      image_url:
        input.image_url !== undefined ? input.image_url : existing.image_url,
      cta_label:
        input.cta_label !== undefined ? input.cta_label : existing.cta_label,
      deep_link:
        input.deep_link !== undefined ? input.deep_link : existing.deep_link,
      sort_order:
        input.sort_order !== undefined ? input.sort_order : existing.sort_order,
      start_date: startDate,
      end_date: endDate,
    },
    include: promotionInclude,
  });
};

/** Publishing a promotion is deliberately silent — no inbox row, no push.
 *  That is the whole reason promotions are not announcements. */
const publishPromotion = async (id: number) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Promotion not found", 404);
  }

  return prisma.promotion.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      // Re-publishing an archived banner keeps its original published_at so
      // the active-list tiebreak stays stable.
      published_at: existing.published_at ?? new Date(),
    },
    include: promotionInclude,
  });
};

const archivePromotion = async (id: number) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Promotion not found", 404);
  }

  return prisma.promotion.update({
    where: { id },
    data: { status: "ARCHIVED" },
    include: promotionInclude,
  });
};

/** The mobile Home carousel's only data source. Window filtering, ordering
 *  and the slide cap all happen here so the client holds no business logic. */
const listActiveForUser = async (userId: number, limit?: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, branch_id: true },
  });

  if (!user) {
    return { data: [], total: 0 };
  }

  const now = new Date();
  const take = Math.min(
    Math.max(limit ?? DEFAULT_ACTIVE_LIMIT, 1),
    MAX_ACTIVE_LIMIT,
  );

  const where: Prisma.promotionWhereInput = {
    status: "PUBLISHED",
    OR: [{ branch_id: user.branch_id }, { branch_id: null }],
    AND: [
      { OR: [{ start_date: null }, { start_date: { lte: now } }] },
      { OR: [{ end_date: null }, { end_date: { gte: now } }] },
    ],
  };

  const rows = await prisma.promotion.findMany({
    where,
    include: promotionInclude,
    orderBy: { published_at: "desc" },
    take: ACTIVE_SCAN_LIMIT,
  });

  // MySQL sorts NULLs first on ASC and Prisma's `nulls: "last"` is
  // Postgres-only, so an unordered banner would otherwise outrank every
  // explicitly ordered one. The active set is small (bounded by
  // ACTIVE_SCAN_LIMIT), so ordering in JS is cheaper than the SQL gymnastics.
  const ordered = rows.sort((a, b) => {
    const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aAt = a.published_at?.getTime() ?? 0;
    const bAt = b.published_at?.getTime() ?? 0;
    return bAt - aAt;
  });

  const data = ordered.slice(0, take);
  return { data, total: data.length };
};

export const promotionService = {
  createPromotion,
  listPromotions,
  getPromotion,
  updatePromotion,
  deletePromotion,
  publishPromotion,
  archivePromotion,
  listActiveForUser,
};
