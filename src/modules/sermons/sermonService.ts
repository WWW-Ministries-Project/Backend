import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { resolveTagIds, toTagSlug } from "./sermonTagService";

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

// Ascending, deliberately: a series is watched front-to-back. `position` is no
// longer written by any path, so every row ties at 0 and ordering by it is
// arbitrary; created_at is the closest stand-in for the order they were added.
//
// The nested sermons are filtered too, not just the series row: a PUBLISHED
// series can contain DRAFT sermons, so hydrating them unconditionally would
// hand a member the drafts inside a series they are allowed to see.
const sermonSeriesIncludeFor = (
  publishedOnly: boolean,
): Prisma.sermon_seriesInclude => ({
  sermons: {
    ...(publishedOnly ? { where: { status: "PUBLISHED" as const } } : {}),
    orderBy: { created_at: "asc" },
  },
});

// The manager-only write paths, which have no reason to hide anything.
const sermonSeriesInclude = sermonSeriesIncludeFor(false);

const httpError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

// The client's form validator treats the protocol as optional, so a link
// pasted as "www.youtube.com/watch?v=..." reaches us scheme-less and would
// otherwise throw in new URL(). Mirrors ensureAbsoluteUrl in the Frontend's
// ChurchCommunication/utils/youtube.ts — the two must stay in step.
const ensureAbsoluteUrl = (url: string): string => {
  const trimmed = url.trim();
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
};

// Port of the frontend extractYouTubeVideoId (LearningUnit.tsx): handles
// youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID, /live/ID.
const extractYouTubeVideoId = (url: string): string | null => {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(ensureAbsoluteUrl(url));
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

type SermonWithRelations = Prisma.sermonGetPayload<{
  include: typeof sermonInclude;
}>;

// Flattens the join rows so clients receive tags: [{id, name, slug}] rather
// than tags: [{tag: {...}}]. Typed against the concrete payload rather than a
// generic: an intersection would leave the join shape visible on the result,
// and pinning the include stops a call site from omitting a relation.
const shapeSermon = (sermon: SermonWithRelations) => ({
  ...sermon,
  tags: sermon.tags.map((row) => row.tag),
});

// Prisma's `contains` builds a LIKE without escaping, so a literal % or _ in
// user input would act as a wildcard.
const escapeLike = (term: string): string => term.replace(/[%_\\]/g, "\\$&");

const assertSeriesExists = async (seriesId: number) => {
  const series = await prisma.sermon_series.findUnique({
    where: { id: seriesId },
    select: { id: true },
  });
  if (!series) throw httpError("Sermon series not found", 404);
};

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
  // Set for callers who may not manage sermons. Overrides `status`, so a
  // member cannot reach draft series by asking for them.
  publishedOnly = false,
) => {
  const effectiveStatus = publishedOnly ? "PUBLISHED" : status;
  const where: Prisma.sermon_seriesWhereInput = {
    ...(getBranchScopedWhere(branchId) ?? {}),
    ...(effectiveStatus ? { status: effectiveStatus } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.sermon_series.findMany({
      where,
      include: sermonSeriesIncludeFor(publishedOnly),
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
    include: sermonSeriesIncludeFor(publishedOnly),
  });
  // Members get published-only detail; a draft is invisible to them (404). The
  // caller derives publishedOnly from the permission probe, not from the query.
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

  // The YouTube lookup is a network call, so it stays outside the transaction.
  const video = await resolveYoutube(url);
  const branchId = await resolveBranchIdOrDefault(input.branch_id);
  // Checked before any tag is written: a bad series id is the likeliest reason
  // this create fails, and tags committed ahead of a failed insert would be
  // stranded in the vocabulary with no way to remove them.
  if (input.series_id) await assertSeriesExists(input.series_id);

  const sermon = await prisma.$transaction(async (tx) => {
    const tagIds = await resolveTagIds(input.tags, tx);
    return tx.sermon.create({
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
  });

  return shapeSermon(sermon);
};

const listSermons = async (params: {
  branchId?: unknown;
  seriesId?: number | null;
  tag?: string | null;
  status?: "DRAFT" | "PUBLISHED";
  // Set for callers who may not manage sermons. Overrides `status`, so a
  // member cannot reach drafts by asking for them.
  publishedOnly?: boolean;
  search?: string | null;
  skip?: number;
  take?: number;
}) => {
  const status = params.publishedOnly ? "PUBLISHED" : params.status;
  // The stored slug is normalized, so the filter has to be too, or a tag like
  // "end times" is unreachable from "End  Times".
  const tagSlug = params.tag ? toTagSlug(params.tag) : null;
  const search = params.search ? escapeLike(params.search) : null;

  const where: Prisma.sermonWhereInput = {
    ...(getBranchScopedWhere(params.branchId) ?? {}),
    ...(params.seriesId ? { series_id: params.seriesId } : {}),
    ...(status ? { status } : {}),
    ...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } },
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
      // Capped: this route is member-accessible and each row hydrates its
      // series and tags.
      take: Math.min(params.take ?? 50, 100),
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

  // Checked here rather than left to Prisma: a missing series surfaces as
  // P2025, which carries no statusCode and so would be reported as a 500.
  // Above the tag resolution for the same reason as in createSermon.
  if (input.series_id !== undefined) {
    if (input.series_id) {
      await assertSeriesExists(input.series_id);
      data.series = { connect: { id: input.series_id } };
    } else {
      data.series = { disconnect: true };
    }
  }

  const sermon = await prisma.$transaction(async (tx) => {
    if (input.tags !== undefined) {
      const tagIds = await resolveTagIds(input.tags, tx);
      data.tags = {
        deleteMany: {},
        create: tagIds.map((tag_id) => ({ tag_id })),
      };
    }

    return tx.sermon.update({
      where: { id },
      data,
      include: sermonInclude,
    });
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
