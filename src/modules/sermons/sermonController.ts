import { Request, Response } from "express";
import { sermonService } from "./sermonService";
import { listTags } from "./sermonTagService";
import { searchTranscripts } from "./sermonTranscriptService";
import { transcribeVideo } from "./whisperTranscriptionService";
import { batchTranscribeRecent } from "./sermonBatchTranscribeService";

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const getActorUserId = (req: Request) => toPositiveInt((req as any)?.user?.id);

/**
 * Whether this request may see unpublished sermons. Derived from
 * `Sermons.view_drafts` (attachSermonDraftAccess), never from a query
 * parameter — a member cannot opt into drafts. Someone who may see drafts can
 * still narrow to published-only by asking for it.
 */
const isPublishedOnly = (req: Request): boolean =>
  !(req as any).canViewSermonDrafts ||
  String(req.query?.published_only ?? "") === "true";

const getStatusCode = (error: unknown): number | null => {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
};

const isNotFoundError = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  (error as { code?: unknown }).code === "P2025";

export class sermonController {
  createSeries = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const body = req.body ?? {};
      if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
        return res.status(400).json({
          message: "title is required",
          data: null,
        });
      }

      const branchId = body.branch_id ?? req.query?.branch_id ?? null;

      const series = await sermonService.createSermonSeries({
        title: body.title,
        description: body.description ?? null,
        branch_id: branchId,
        created_by: actorUserId,
      });

      return res
        .status(201)
        .json({ message: "Sermon series created", data: series });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to create sermon series",
        data: null,
      });
    }
  };

  listSeries = async (req: Request, res: Response) => {
    try {
      const branchId = req.query?.branch_id ?? null;
      const skip = toPositiveInt(req.query?.skip) ?? 0;
      const take = toPositiveInt(req.query?.take) ?? 20;

      // No status filter: a series has no publish state to filter on.
      const result = await sermonService.listSermonSeries(
        branchId,
        skip,
        take,
        isPublishedOnly(req),
      );

      return res.status(200).json({ message: "Sermon series", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list sermon series",
        data: null,
      });
    }
  };

  getOneSeries = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const series = await sermonService.getSermonSeries(
        id,
        isPublishedOnly(req),
      );
      if (!series) {
        return res
          .status(404)
          .json({ message: "Sermon series not found", data: null });
      }

      return res.status(200).json({ message: "Sermon series", data: series });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to fetch sermon series",
        data: null,
      });
    }
  };

  updateSeries = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const body = req.body ?? {};
      const series = await sermonService.updateSermonSeries(id, {
        title: body.title,
        description: body.description,
      });

      return res
        .status(200)
        .json({ message: "Sermon series updated", data: series });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to update sermon series",
        data: null,
      });
    }
  };

  removeSeries = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      await sermonService.deleteSermonSeries(id);
      return res
        .status(200)
        .json({ message: "Sermon series deleted", data: null });
    } catch (error) {
      if (isNotFoundError(error)) {
        return res
          .status(404)
          .json({ message: "Sermon series not found", data: null });
      }
      return res.status(500).json({
        message: (error as Error).message || "Failed to delete sermon series",
        data: null,
      });
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const body = req.body ?? {};
      const sermon = await sermonService.createSermon({
        title: body.title,
        description: body.description ?? null,
        youtube_url: body.youtube_url,
        series_id: toPositiveInt(body.series_id),
        tags: Array.isArray(body.tags) ? body.tags : [],
        preached_at: body.preached_at ?? null,
        branch_id: body.branch_id ?? req.query?.branch_id ?? null,
        created_by: actorUserId,
      });

      return res.status(201).json({ message: "Sermon created", data: sermon });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to create sermon",
        data: null,
      });
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const statusParam = String(req.query?.status ?? "").toUpperCase();
      const status =
        statusParam === "PUBLISHED" || statusParam === "DRAFT"
          ? (statusParam as "PUBLISHED" | "DRAFT")
          : undefined;

      const search = String(req.query?.q ?? "").trim();
      const tag = String(req.query?.tag ?? "").trim();

      const result = await sermonService.listSermons({
        branchId: req.query?.branch_id ?? null,
        seriesId: toPositiveInt(req.query?.series_id),
        tag: tag || null,
        status,
        publishedOnly: isPublishedOnly(req),
        search: search || null,
        skip: toPositiveInt(req.query?.skip) ?? 0,
        take: toPositiveInt(req.query?.take) ?? 50,
      });

      return res.status(200).json({ message: "Sermons", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list sermons",
        data: null,
      });
    }
  };

  getOne = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) return res.status(400).json({ message: "Invalid id", data: null });

      const sermon = await sermonService.getSermon(id, isPublishedOnly(req));
      if (!sermon) {
        return res.status(404).json({ message: "Sermon not found", data: null });
      }

      return res.status(200).json({ message: "Sermon", data: sermon });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to fetch sermon",
        data: null,
      });
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) return res.status(400).json({ message: "Invalid id", data: null });

      const body = req.body ?? {};
      const sermon = await sermonService.updateSermon(id, {
        title: body.title,
        description: body.description,
        youtube_url: body.youtube_url,
        // Explicit null clears the series; an absent key leaves it untouched.
        series_id:
          body.series_id === undefined
            ? undefined
            : toPositiveInt(body.series_id),
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        preached_at: body.preached_at,
      });

      return res.status(200).json({ message: "Sermon updated", data: sermon });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to update sermon",
        data: null,
      });
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) return res.status(400).json({ message: "Invalid id", data: null });

      await sermonService.deleteSermon(id);
      return res.status(200).json({ message: "Sermon deleted", data: null });
    } catch (error) {
      if (isNotFoundError(error)) {
        return res.status(404).json({ message: "Sermon not found", data: null });
      }
      return res.status(500).json({
        message: (error as Error).message || "Failed to delete sermon",
        data: null,
      });
    }
  };

  publish = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) return res.status(400).json({ message: "Invalid id", data: null });

      const sermon = await sermonService.setSermonStatus(id, true);
      return res.status(200).json({ message: "Sermon published", data: sermon });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to publish sermon",
        data: null,
      });
    }
  };

  unpublish = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) return res.status(400).json({ message: "Invalid id", data: null });

      const sermon = await sermonService.setSermonStatus(id, false);
      return res
        .status(200)
        .json({ message: "Sermon unpublished", data: sermon });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to unpublish sermon",
        data: null,
      });
    }
  };

  /**
   * Keyword search over the spoken content of YouTube sermon videos. The client
   * sends the query and the video ids it currently has loaded (the Messages
   * view pages itself from YouTube); we fetch each video's captions, match, and
   * return the videos that contain the words along with a snippet and a seek
   * offset. A video without captions is simply absent from the results.
   */
  searchTranscripts = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const q = String(body.q ?? body.query ?? "").trim();
      if (!q) {
        return res.status(400).json({ message: "A search query is required", data: null });
      }

      const rawIds = Array.isArray(body.video_ids)
        ? body.video_ids
        : Array.isArray(body.videoIds)
          ? body.videoIds
          : [];
      const videoIds = rawIds
        .map((value: unknown) => String(value ?? "").trim())
        .filter(Boolean);
      if (videoIds.length === 0) {
        return res.status(200).json({ message: "No videos to search", data: [] });
      }

      const data = await searchTranscripts(q, videoIds);
      return res.status(200).json({ message: "Transcript matches", data });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to search sermon transcripts",
        data: null,
      });
    }
  };

  /**
   * Transcribes one YouTube sermon with Whisper and stores the result. Spends
   * OpenAI credit, so it is gated behind sermon-management permission. Runs
   * synchronously for the prototype — a long video can take minutes, so a
   * production build would move this to a background job with a status endpoint.
   */
  transcribeSermon = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const videoId = String(body.video_id ?? body.videoId ?? "").trim();
      if (!videoId) {
        return res.status(400).json({ message: "video_id is required", data: null });
      }
      const force = body.force === true || String(req.query?.force ?? "") === "true";

      const result = await transcribeVideo(videoId, { force });
      return res.status(200).json({
        message: result.cached ? "Transcript already available" : "Sermon transcribed",
        data: {
          video_id: result.video_id,
          cached: result.cached,
          source: result.source,
          model: result.model,
          segment_count: result.segments.length,
        },
      });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to transcribe sermon",
        data: null,
      });
    }
  };

  /**
   * Transcribes the channel's recent videos now, instead of waiting for the
   * cron. Free (captions) by default; pass allow_whisper to let uncaptioned
   * videos fall back to the paid model. Gated to sermon managers.
   */
  transcribeRecent = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const limit = toPositiveInt(body.limit ?? req.query?.limit) ?? undefined;
      const allowWhisper =
        body.allow_whisper === true || String(req.query?.allow_whisper ?? "") === "true";

      const summary = await batchTranscribeRecent({ limit, allowWhisper });
      return res.status(200).json({ message: "Batch transcription complete", data: summary });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to batch transcribe sermons",
        data: null,
      });
    }
  };

  listTags = async (req: Request, res: Response) => {
    try {
      const data = await listTags(req.query?.q);
      return res.status(200).json({ message: "Sermon tags", data });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list sermon tags",
        data: null,
      });
    }
  };
}
