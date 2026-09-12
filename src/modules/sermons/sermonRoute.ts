import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { sermonController } from "./sermonController";

const controller = new sermonController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();

// Static paths first: /:id would otherwise swallow "series" and "tags".
router.get("/tags", [protect], controller.listTags);

router.get(
  "/series",
  [protect, permissions.attach_sermon_management],
  controller.listSeries,
);
router.get(
  "/series/:id",
  [protect, permissions.attach_sermon_management],
  controller.getOneSeries,
);
router.post(
  "/series",
  [protect, permissions.can_manage_sermons],
  controller.createSeries,
);
router.put(
  "/series/:id",
  [protect, permissions.can_manage_sermons],
  controller.updateSeries,
);
router.delete(
  "/series/:id",
  [protect, permissions.can_delete_sermons],
  controller.removeSeries,
);
router.post(
  "/series/:id/publish",
  [protect, permissions.can_manage_sermons],
  controller.publishSeries,
);
router.post(
  "/series/:id/unpublish",
  [protect, permissions.can_manage_sermons],
  controller.unpublishSeries,
);

// Sermons. Open to any authenticated member for reads; writes stay gated.
router.get("/", [protect, permissions.attach_sermon_management], controller.list);
router.get(
  "/:id",
  [protect, permissions.attach_sermon_management],
  controller.getOne,
);

router.post("/", [protect, permissions.can_manage_sermons], controller.create);
router.put("/:id", [protect, permissions.can_manage_sermons], controller.update);
router.post(
  "/:id/publish",
  [protect, permissions.can_manage_sermons],
  controller.publish,
);
router.post(
  "/:id/unpublish",
  [protect, permissions.can_manage_sermons],
  controller.unpublish,
);
router.delete(
  "/:id",
  [protect, permissions.can_delete_sermons],
  controller.remove,
);

export default router;
