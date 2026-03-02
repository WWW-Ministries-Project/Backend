import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { notificationController } from "./notificationController";
import {
  extractBearerTokenFromHeader,
  extractStreamTokenFromQuery,
  verifyNotificationStreamToken,
} from "./notificationStreamAuth";

const notificationRouter = Router();
const permissions = new Permissions();

const streamAuth = (req: any, res: any, next: any) => {
  const bearerToken = extractBearerTokenFromHeader(req);
  if (bearerToken) {
    return permissions.protect(req, res, next);
  }

  const streamToken = extractStreamTokenFromQuery(req);
  if (!streamToken) {
    return res
      .status(401)
      .json({ message: "Not authorized. Token not found", data: null });
  }

  const userId = verifyNotificationStreamToken(streamToken);
  if (!userId) {
    return res
      .status(401)
      .json({ message: "Session Expired", data: "Session Expired" });
  }

  req.user = {
    ...(req.user || {}),
    id: userId,
  };
  return next();
};

notificationRouter.get(
  "/stream-token",
  [permissions.protect],
  notificationController.issueStreamToken,
);

notificationRouter.get(
  "/",
  [permissions.protect],
  notificationController.listNotifications,
);

notificationRouter.get(
  "/unread-count",
  [permissions.protect],
  notificationController.getUnreadCount,
);

notificationRouter.patch(
  "/:id/read",
  [permissions.protect],
  notificationController.markAsRead,
);

notificationRouter.patch(
  "/:id/unread",
  [permissions.protect],
  notificationController.markAsUnread,
);

notificationRouter.patch(
  "/read-all",
  [permissions.protect],
  notificationController.markAllAsRead,
);

notificationRouter.get(
  "/stream",
  [streamAuth],
  notificationController.stream,
);

export default notificationRouter;
