import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { announcementController } from "./announcementController";

const controller = new announcementController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();

// `/mine` and `/unread-count` must be registered before `/:id` so they are
// not captured as an id.
router.get("/mine", [protect], controller.mine);
router.get("/unread-count", [protect], controller.unreadCount);

router.get("/", [protect, permissions.can_view_announcements], controller.list);
router.get(
  "/:id",
  [protect, permissions.can_view_announcements],
  controller.getOne,
);

router.post(
  "/",
  [protect, permissions.can_manage_announcements],
  controller.create,
);
router.put(
  "/:id",
  [protect, permissions.can_manage_announcements],
  controller.update,
);
router.post(
  "/:id/publish",
  [protect, permissions.can_manage_announcements],
  controller.publish,
);
router.patch("/:id/read", [protect], controller.markAsRead);

router.delete(
  "/:id",
  [protect, permissions.can_delete_announcements],
  controller.remove,
);

export default router;
