import { Request, Response } from "express";
import { sermonService } from "./sermonService";

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const getActorUserId = (req: Request) => toPositiveInt((req as any)?.user?.id);

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
      if (!body.title || !Array.isArray(body.sermons) || body.sermons.length === 0) {
        return res.status(400).json({
          message: "title and at least one sermon link are required",
          data: null,
        });
      }

      const branchId = body.branch_id ?? req.query?.branch_id ?? null;

      const series = await sermonService.createSermonSeries({
        title: body.title,
        description: body.description ?? null,
        sermons: body.sermons,
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

  list = async (req: Request, res: Response) => {
    try {
      const branchId = req.query?.branch_id ?? null;
      const skip = toPositiveInt(req.query?.skip) ?? 0;
      const take = toPositiveInt(req.query?.take) ?? 20;

      const result = await sermonService.listSermonSeries(branchId, skip, take);

      return res.status(200).json({ message: "Sermon series", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list sermon series",
        data: null,
      });
    }
  };

  getOne = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const series = await sermonService.getSermonSeries(id);
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

  update = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const body = req.body ?? {};
      const series = await sermonService.updateSermonSeries(id, {
        title: body.title,
        description: body.description,
        sermons: body.sermons,
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

  remove = async (req: Request, res: Response) => {
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

  publish = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const series = await sermonService.publishSermonSeries(id);
      return res
        .status(200)
        .json({ message: "Sermon series published", data: series });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to publish sermon series",
        data: null,
      });
    }
  };

  unpublish = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const series = await sermonService.unpublishSermonSeries(id);
      return res
        .status(200)
        .json({ message: "Sermon series unpublished", data: series });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to unpublish sermon series",
        data: null,
      });
    }
  };
}
