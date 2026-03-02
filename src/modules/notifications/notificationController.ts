import { Request, Response } from "express";
import { InputValidationError } from "../../utils/custom-error-handlers";
import { notificationService } from "./notificationService";
import { issueNotificationStreamToken } from "./notificationStreamAuth";

const getAuthenticatedUserId = (req: Request): number => {
  const parsed = Number((req as any)?.user?.id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputValidationError("Authenticated user not found");
  }

  return parsed;
};

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InputValidationError("Query parameter must be a positive integer");
  }

  return parsed;
};

const parseUnreadOnly = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "unread"].includes(normalized);
};

export class NotificationController {
  async issueStreamToken(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const streamTokenData = issueNotificationStreamToken(userId);

    res.status(200).json({
      message: "Notification stream token issued",
      data: {
        streamToken: streamTokenData.token,
        expiresInSeconds: streamTokenData.expiresInSeconds,
      },
    });
  }

  async listNotifications(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const page = parseOptionalPositiveInt(req.query.page);
    const limit = parseOptionalPositiveInt(req.query.limit);
    const unreadOnly = parseUnreadOnly(req.query.unreadOnly ?? req.query.unread);

    const response = await notificationService.listNotifications(userId, {
      page,
      limit,
      unreadOnly,
    });

    res.status(200).json({
      message: "Notifications retrieved successfully",
      data: response,
    });
  }

  async getUnreadCount(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const unreadCount = await notificationService.getUnreadCount(userId);

    res.status(200).json({
      message: "Unread count retrieved successfully",
      data: {
        unreadCount,
      },
    });
  }

  async markAsRead(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      throw new InputValidationError("Notification id must be a positive integer");
    }

    const data = await notificationService.markNotificationAsRead(
      userId,
      notificationId,
    );

    res.status(200).json({
      message: "Notification marked as read",
      data,
    });
  }

  async markAsUnread(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      throw new InputValidationError("Notification id must be a positive integer");
    }

    const data = await notificationService.markNotificationAsUnread(
      userId,
      notificationId,
    );

    res.status(200).json({
      message: "Notification marked as unread",
      data,
    });
  }

  async markAllAsRead(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    const data = await notificationService.markAllNotificationsAsRead(userId);

    res.status(200).json({
      message: "Notifications marked as read",
      data,
    });
  }

  async stream(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await notificationService.startSseStream(userId, res);
  }
}

export const notificationController = new NotificationController();
