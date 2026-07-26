import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";

export type SermonInput = {
  id?: number;
  youtube_url: string;
};

export type CreateSermonSeriesInput = {
  title: string;
  description?: string | null;
  sermons: SermonInput[];
  branch_id?: number | null;
  created_by: number;
};

export type UpdateSermonSeriesInput = {
  title?: string;
  description?: string | null;
  sermons?: SermonInput[];
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

const resolveSermonRows = async (sermons: SermonInput[]) => {
  const resolved = await Promise.all(
    sermons.map((sermon) => resolveYoutube(sermon.youtube_url)),
  );
  return resolved.map((video, index) => ({
    youtube_url: sermons[index].youtube_url,
    title: video.title,
    video_id: video.video_id,
    position: index,
  }));
};

const validateSermons = (sermons: unknown): SermonInput[] => {
  if (!Array.isArray(sermons) || sermons.length === 0) {
    throw httpError("A series requires at least one sermon link", 400);
  }
  return sermons.map((sermon) => {
    const url = (sermon as SermonInput)?.youtube_url;
    if (!url || typeof url !== "string" || !url.trim()) {
      throw httpError("Each sermon requires a youtube_url", 400);
    }
    const id = (sermon as SermonInput)?.id;
    return { id: typeof id === "number" ? id : undefined, youtube_url: url.trim() };
  });
};

const createSermonSeries = async (input: CreateSermonSeriesInput) => {
  const sermons = validateSermons(input.sermons);
  const branchId = await resolveBranchIdOrDefault(input.branch_id);
  const rows = await resolveSermonRows(sermons);

  return prisma.sermon_series.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      status: "DRAFT",
      branch_id: branchId,
      created_by: input.created_by,
      sermons: { create: rows },
    },
    include: sermonSeriesInclude,
  });
};

const listSermonSeries = async (branchId: unknown, skip = 0, take = 20) => {
  const where: Prisma.sermon_seriesWhereInput = {
    ...(getBranchScopedWhere(branchId) ?? {}),
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

const getSermonSeries = async (id: number) =>
  prisma.sermon_series.findUnique({
    where: { id },
    include: sermonSeriesInclude,
  });

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

  // When sermons are supplied, replace the set: keep unchanged URLs (reuse their
  // stored title), re-resolve new/changed URLs, drop the rest.
  let sermonsWrite: Prisma.sermonUpdateManyWithoutSeriesNestedInput | undefined;
  if (input.sermons !== undefined) {
    const incoming = validateSermons(input.sermons);
    const existingByUrl = new Map(
      existing.sermons.map((sermon) => [sermon.youtube_url, sermon]),
    );

    const rows = await Promise.all(
      incoming.map(async (sermon, index) => {
        const prior = existingByUrl.get(sermon.youtube_url);
        if (prior) {
          return {
            youtube_url: prior.youtube_url,
            title: prior.title,
            video_id: prior.video_id,
            position: index,
          };
        }
        const video = await resolveYoutube(sermon.youtube_url);
        return {
          youtube_url: sermon.youtube_url,
          title: video.title,
          video_id: video.video_id,
          position: index,
        };
      }),
    );

    sermonsWrite = {
      deleteMany: {},
      create: rows,
    };
  }

  return prisma.sermon_series.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      description:
        input.description === undefined
          ? existing.description
          : input.description,
      ...(sermonsWrite ? { sermons: sermonsWrite } : {}),
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

export const sermonService = {
  createSermonSeries,
  listSermonSeries,
  getSermonSeries,
  updateSermonSeries,
  deleteSermonSeries,
  publishSermonSeries,
  unpublishSermonSeries,
};
