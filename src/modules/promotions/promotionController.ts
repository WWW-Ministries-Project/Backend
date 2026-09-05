import { Request, Response } from "express";
import { promotion_status } from "@prisma/client";
import { promotionService } from "./promotionService";

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

/** `undefined` = field not sent (leave existing value alone on update).
 *  `null` = field explicitly cleared. Otherwise the coerced value. */
const toOptionalString = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return typeof value === "string" ? value : undefined;
};

const toOptionalInt = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const toOptionalDate = (value: unknown): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const PROMOTION_STATUSES: promotion_status[] = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
];

const toStatus = (value: unknown): promotion_status | undefined => {
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase() as promotion_status;
  return PROMOTION_STATUSES.includes(upper) ? upper : undefined;
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

export class promotionController {
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
      if (!body.title) {
        return res
          .status(400)
          .json({ message: "title is required", data: null });
      }

      const branchId = body.branch_id ?? req.query?.branch_id ?? null;

      const promotion = await promotionService.createPromotion({
        title: body.title,
        subtitle: toOptionalString(body.subtitle),
        image_url: toOptionalString(body.image_url),
        cta_label: toOptionalString(body.cta_label),
        deep_link: toOptionalString(body.deep_link),
        sort_order: toOptionalInt(body.sort_order),
        start_date: toOptionalDate(body.start_date),
        end_date: toOptionalDate(body.end_date),
        branch_id: branchId,
        created_by: actorUserId,
      });

      return res
        .status(201)
        .json({ message: "Promotion created", data: promotion });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to create promotion",
        data: null,
      });
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const branchId = req.query?.branch_id ?? null;
      const status = toStatus(req.query?.status);
      const skip = toPositiveInt(req.query?.skip) ?? 0;
      const take = toPositiveInt(req.query?.take) ?? 20;

      const result = await promotionService.listPromotions(
        branchId,
        status,
        skip,
        take,
      );

      return res.status(200).json({ message: "Promotions", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list promotions",
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

      const promotion = await promotionService.getPromotion(id);
      if (!promotion) {
        return res
          .status(404)
          .json({ message: "Promotion not found", data: null });
      }

      return res.status(200).json({ message: "Promotion", data: promotion });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to fetch promotion",
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
      const promotion = await promotionService.updatePromotion(id, {
        title: body.title,
        subtitle: toOptionalString(body.subtitle),
        image_url: toOptionalString(body.image_url),
        cta_label: toOptionalString(body.cta_label),
        deep_link: toOptionalString(body.deep_link),
        sort_order: toOptionalInt(body.sort_order),
        start_date: toOptionalDate(body.start_date),
        end_date: toOptionalDate(body.end_date),
      });

      return res
        .status(200)
        .json({ message: "Promotion updated", data: promotion });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to update promotion",
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

      await promotionService.deletePromotion(id);
      return res.status(200).json({ message: "Promotion deleted", data: null });
    } catch (error) {
      if (isNotFoundError(error)) {
        return res
          .status(404)
          .json({ message: "Promotion not found", data: null });
      }
      return res.status(500).json({
        message: (error as Error).message || "Failed to delete promotion",
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

      const promotion = await promotionService.publishPromotion(id);
      return res
        .status(200)
        .json({ message: "Promotion published", data: promotion });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to publish promotion",
        data: null,
      });
    }
  };

  archive = async (req: Request, res: Response) => {
    try {
      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const promotion = await promotionService.archivePromotion(id);
      return res
        .status(200)
        .json({ message: "Promotion archived", data: promotion });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to archive promotion",
        data: null,
      });
    }
  };

  /** Mobile Home carousel. Any authenticated member may call this — there is
   *  no `Promotions` permission on it, the same way `/announcements/mine` is
   *  open to every signed-in user. */
  active = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const limit = toPositiveInt(req.query?.limit) ?? undefined;
      const result = await promotionService.listActiveForUser(
        actorUserId,
        limit,
      );

      return res.status(200).json({ message: "Promotions", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list promotions",
        data: null,
      });
    }
  };
}
