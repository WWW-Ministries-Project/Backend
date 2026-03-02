import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { notificationController } from "./notificationController";

const notificationRouter = Router();
const permissions = new Permissions();

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
  [permissions.protect],
  notificationController.stream,
);

export default notificationRouter;

