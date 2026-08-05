import { Request, Response } from "express";
import { announcementService } from "./announcementService";

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

export class announcementController {
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
      if (!body.title || !body.content || !body.audience_type) {
        return res.status(400).json({
          message: "title, content and audience_type are required",
          data: null,
        });
      }

      const branchId = body.branch_id ?? req.query?.branch_id ?? null;

      const announcement = await announcementService.createAnnouncement({
        title: body.title,
        content: body.content,
        audience_type: body.audience_type,
        department_id: toPositiveInt(body.department_id),
        position_id: toPositiveInt(body.position_id),
        branch_id: branchId,
        created_by: actorUserId,
      });

      return res
        .status(201)
        .json({ message: "Announcement created", data: announcement });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to create announcement",
        data: null,
      });
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const branchId = req.query?.branch_id ?? null;
      const skip = toPositiveInt(req.query?.skip) ?? 0;
      const take = toPositiveInt(req.query?.take) ?? 20;

      const result = await announcementService.listAnnouncements(
        branchId,
        skip,
        take,
      );

      return res.status(200).json({ message: "Announcements", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list announcements",
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

      const announcement = await announcementService.getAnnouncement(id);
      if (!announcement) {
        return res
          .status(404)
          .json({ message: "Announcement not found", data: null });
      }

      return res.status(200).json({ message: "Announcement", data: announcement });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to fetch announcement",
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
      const announcement = await announcementService.updateAnnouncement(id, {
        title: body.title,
        content: body.content,
        audience_type: body.audience_type,
        department_id:
          body.department_id === undefined
            ? undefined
            : toPositiveInt(body.department_id),
        position_id:
          body.position_id === undefined
            ? undefined
            : toPositiveInt(body.position_id),
      });

      return res
        .status(200)
        .json({ message: "Announcement updated", data: announcement });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to update announcement",
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

      await announcementService.deleteAnnouncement(id);
      return res
        .status(200)
        .json({ message: "Announcement deleted", data: null });
    } catch (error) {
      if (isNotFoundError(error)) {
        return res
          .status(404)
          .json({ message: "Announcement not found", data: null });
      }
      return res.status(500).json({
        message: (error as Error).message || "Failed to delete announcement",
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

      const actorUserId = getActorUserId(req) ?? undefined;
      const result = await announcementService.publishAnnouncement(
        id,
        actorUserId,
      );

      return res.status(200).json({
        message: "Announcement published",
        data: result.announcement,
        recipientCount: result.recipientCount,
      });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to publish announcement",
        data: null,
      });
    }
  };

  mine = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const skip = toPositiveInt(req.query?.skip) ?? 0;
      const take = toPositiveInt(req.query?.take) ?? 20;

      const result = await announcementService.listForUser(
        actorUserId,
        skip,
        take,
      );

      return res.status(200).json({ message: "Announcements", ...result });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to list announcements",
        data: null,
      });
    }
  };

  unreadCount = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const unreadCount = await announcementService.getUnreadCountForUser(
        actorUserId,
      );

      return res.status(200).json({
        message: "Unread count retrieved successfully",
        data: { unreadCount },
      });
    } catch (error) {
      return res.status(500).json({
        message: (error as Error).message || "Failed to get unread count",
        data: null,
      });
    }
  };

  markAsRead = async (req: Request, res: Response) => {
    try {
      const actorUserId = getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const id = toPositiveInt(req.params?.id);
      if (!id) {
        return res.status(400).json({ message: "Invalid id", data: null });
      }

      const receipt = await announcementService.markAnnouncementAsRead(
        actorUserId,
        id,
      );

      return res
        .status(200)
        .json({ message: "Announcement marked as read", data: receipt });
    } catch (error) {
      const statusCode = getStatusCode(error) ?? 500;
      return res.status(statusCode).json({
        message: (error as Error).message || "Failed to mark announcement as read",
        data: null,
      });
    }
  };
}
