import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { resolveTagIds } from "./sermonTagService";

export type CreateSermonSeriesInput = {
  title: string;
  description?: string | null;
  branch_id?: number | null;
  created_by: number;
};

export type UpdateSermonSeriesInput = {
  title?: string;
  description?: string | null;
};

export type CreateSermonInput = {
  title: string;
  description?: string | null;
  youtube_url: string;
  series_id?: number | null;
  tags?: string[];
  branch_id?: number | null;
  created_by: number;
};

export type UpdateSermonInput = {
  title?: string;
  description?: string | null;
  youtube_url?: string;
  series_id?: number | null;
  tags?: string[];
};

const sermonSeriesInclude: Prisma.sermon_seriesInclude = {
  sermons: { orderBy: { position: "asc" } },
};

const httpError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

// Port of the frontend extractYouTubeVideoId (LearningUnit.tsx): handles
// youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID, /live/ID.
const extractYouTubeVideoId = (url: string): string | null => {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id || null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v");
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && ["embed", "shorts", "live", "v"].includes(segments[0])) {
      return segments[1];
    }
  }

  return null;
};

type ResolvedVideo = { video_id: string; title: string };

// Resolves the video id from the URL and fetches its title via YouTube oEmbed.
// Falls back to the video id as the title if oEmbed is unreachable.
const resolveYoutube = async (url: string): Promise<ResolvedVideo> => {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw httpError(`Invalid YouTube URL: ${url}`, 400);
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      url,
    )}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`oEmbed responded ${response.status}`);
    }
    const data = (await response.json()) as { title?: string };
    return { video_id: videoId, title: data.title?.trim() || videoId };
  } catch (error) {
    // Do not hard-fail: the URL parsed to a valid video id, so persist it with
    // the id as the title and let a later edit refresh it.
    console.warn(
      `Failed to fetch YouTube title for ${url}: ${(error as Error).message}`,
    );
    return { video_id: videoId, title: videoId };
  }
};

const thumbnailForVideoId = (videoId: string | null): string | null =>
  videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

const sermonInclude = {
  series: { select: { id: true, title: true } },
  tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.sermonInclude;

// Flattens the join rows so clients receive tags: [{id, name, slug}] rather
// than tags: [{tag: {...}}].
const shapeSermon = <T extends { tags: { tag: TagShape }[] }>(sermon: T) => ({
  ...sermon,
  tags: sermon.tags.map((row) => row.tag),
});

type TagShape = { id: number; name: string; slug: string };

const createSermonSeries = async (input: CreateSermonSeriesInput) => {
  const branchId = await resolveBranchIdOrDefault(input.branch_id);

  return prisma.sermon_series.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      status: "DRAFT",
      branch_id: branchId,
      created_by: input.created_by,
    },
    include: sermonSeriesInclude,
  });
};

const listSermonSeries = async (
  branchId: unknown,
  skip = 0,
  take = 20,
  status?: "DRAFT" | "PUBLISHED",
) => {
  const where: Prisma.sermon_seriesWhereInput = {
    ...(getBranchScopedWhere(branchId) ?? {}),
    ...(status ? { status } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.sermon_series.findMany({
      where,
      include: sermonSeriesInclude,
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    prisma.sermon_series.count({ where }),
  ]);

  return { data, total };
};

const getSermonSeries = async (id: number, publishedOnly = false) => {
  const series = await prisma.sermon_series.findUnique({
    where: { id },
    include: sermonSeriesInclude,
  });
  // Members request published-only detail; a draft is invisible to them (404).
  if (publishedOnly && series?.status !== "PUBLISHED") return null;
  return series;
};

const deleteSermonSeries = async (id: number) =>
  prisma.sermon_series.delete({ where: { id } });

const updateSermonSeries = async (
  id: number,
  input: UpdateSermonSeriesInput,
) => {
  const existing = await prisma.sermon_series.findUnique({
    where: { id },
    include: sermonSeriesInclude,
  });
  if (!existing) {
    throw httpError("Sermon series not found", 404);
  }

  return prisma.sermon_series.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      description:
        input.description === undefined
          ? existing.description
          : input.description,
    },
    include: sermonSeriesInclude,
  });
};

const publishSermonSeries = async (id: number) => {
  const existing = await prisma.sermon_series.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Sermon series not found", 404);
  }
  if (existing.status === "PUBLISHED") {
    throw httpError("Sermon series is already published", 409);
  }

  return prisma.sermon_series.update({
    where: { id },
    data: { status: "PUBLISHED", published_at: new Date() },
    include: sermonSeriesInclude,
  });
};

const unpublishSermonSeries = async (id: number) => {
  const existing = await prisma.sermon_series.findUnique({ where: { id } });
  if (!existing) {
    throw httpError("Sermon series not found", 404);
  }

  return prisma.sermon_series.update({
    where: { id },
    data: { status: "DRAFT", published_at: null },
    include: sermonSeriesInclude,
  });
};

const createSermon = async (input: CreateSermonInput) => {
  const title = input.title?.trim();
  if (!title) throw httpError("A sermon title is required", 400);

  const url = input.youtube_url?.trim();
  if (!url) throw httpError("A YouTube link is required", 400);

  const video = await resolveYoutube(url);
  const branchId = await resolveBranchIdOrDefault(input.branch_id);
  const tagIds = await resolveTagIds(input.tags);

  if (input.series_id) {
    const series = await prisma.sermon_series.findUnique({
      where: { id: input.series_id },
      select: { id: true },
    });
    if (!series) throw httpError("Sermon series not found", 404);
  }

  const sermon = await prisma.sermon.create({
    data: {
      title,
      description: input.description?.trim() || null,
      youtube_url: url,
      video_id: video.video_id,
      thumbnail_url: thumbnailForVideoId(video.video_id),
      series_id: input.series_id ?? null,
      branch_id: branchId,
      created_by: input.created_by,
      status: "DRAFT",
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
    },
    include: sermonInclude,
  });

  return shapeSermon(sermon);
};

const listSermons = async (params: {
  branchId?: unknown;
  seriesId?: number | null;
  tag?: string | null;
  status?: "DRAFT" | "PUBLISHED";
  search?: string | null;
  skip?: number;
  take?: number;
}) => {
  const where: Prisma.sermonWhereInput = {
    ...(getBranchScopedWhere(params.branchId) ?? {}),
    ...(params.seriesId ? { series_id: params.seriesId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.tag ? { tags: { some: { tag: { slug: params.tag } } } } : {}),
    ...(params.search
      ? {
          OR: [
            { title: { contains: params.search } },
            { description: { contains: params.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.sermon.findMany({
      where,
      include: sermonInclude,
      orderBy: { created_at: "desc" },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    }),
    prisma.sermon.count({ where }),
  ]);

  return { data: rows.map(shapeSermon), total };
};

const getSermon = async (id: number, publishedOnly = false) => {
  const sermon = await prisma.sermon.findUnique({
    where: { id },
    include: sermonInclude,
  });
  if (!sermon) return null;
  if (publishedOnly && sermon.status !== "PUBLISHED") return null;
  return shapeSermon(sermon);
};

const updateSermon = async (id: number, input: UpdateSermonInput) => {
  const existing = await prisma.sermon.findUnique({ where: { id } });
  if (!existing) throw httpError("Sermon not found", 404);

  const data: Prisma.sermonUpdateInput = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw httpError("A sermon title is required", 400);
    data.title = title;
  }

  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }

  // Only re-hit YouTube when the URL actually changed.
  if (input.youtube_url !== undefined) {
    const url = input.youtube_url.trim();
    if (!url) throw httpError("A YouTube link is required", 400);
    if (url !== existing.youtube_url) {
      const video = await resolveYoutube(url);
      data.youtube_url = url;
      data.video_id = video.video_id;
      data.thumbnail_url = thumbnailForVideoId(video.video_id);
    }
  }

  if (input.series_id !== undefined) {
    data.series = input.series_id
      ? { connect: { id: input.series_id } }
      : { disconnect: true };
  }

  if (input.tags !== undefined) {
    const tagIds = await resolveTagIds(input.tags);
    data.tags = {
      deleteMany: {},
      create: tagIds.map((tag_id) => ({ tag_id })),
    };
  }

  const sermon = await prisma.sermon.update({
    where: { id },
    data,
    include: sermonInclude,
  });

  return shapeSermon(sermon);
};

const deleteSermon = async (id: number) =>
  prisma.sermon.delete({ where: { id } });

const setSermonStatus = async (id: number, publish: boolean) => {
  const existing = await prisma.sermon.findUnique({ where: { id } });
  if (!existing) throw httpError("Sermon not found", 404);
  if (publish && existing.status === "PUBLISHED") {
    throw httpError("Sermon is already published", 409);
  }

  const sermon = await prisma.sermon.update({
    where: { id },
    data: publish
      ? { status: "PUBLISHED", published_at: new Date() }
      : { status: "DRAFT", published_at: null },
    include: sermonInclude,
  });

  return shapeSermon(sermon);
};

export const sermonService = {
  createSermonSeries,
  listSermonSeries,
  getSermonSeries,
  updateSermonSeries,
  deleteSermonSeries,
  publishSermonSeries,
  unpublishSermonSeries,
  createSermon,
  listSermons,
  getSermon,
  updateSermon,
  deleteSermon,
  setSermonStatus,
};
