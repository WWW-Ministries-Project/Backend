import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { promotionController } from "./promotionController";
import { requirePromotionsInBranch as inBranch } from "./promotionAccess";

const controller = new promotionController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();
const action = (name: string, message: string) =>
  permissions.requireAction("Promotions", name, message);

// `/active` must be registered before `/:id` so it is not captured as an id.
router.get("/active", [protect], controller.active);

router.get("/", [protect, permissions.can_view_promotions], controller.list);
// Before `/:id` routes for the same reason as `/active`.
router.post(
  "/reorder",
  [protect, action("reorder", "Not authorized to reorder promotions"), inBranch],
  controller.reorder,
);
router.get(
  "/:id",
  [protect, permissions.can_view_promotions, inBranch],
  controller.getOne,
);

router.post(
  "/",
  [protect, action("create", "Not authorized to create promotions")],
  controller.create,
);
router.put(
  "/:id",
  [protect, action("create", "Not authorized to edit promotions"), inBranch],
  controller.update,
);
router.post(
  "/:id/publish",
  [protect, action("publish", "Not authorized to publish promotions"), inBranch],
  controller.publish,
);
router.post(
  "/:id/unpublish",
  [protect, action("publish", "Not authorized to unpublish promotions"), inBranch],
  controller.unpublish,
);
router.post(
  "/:id/archive",
  [protect, action("archive", "Not authorized to archive promotions"), inBranch],
  controller.archive,
);

router.delete(
  "/:id",
  [protect, action("delete", "Not authorized to delete promotions"), inBranch],
  controller.remove,
);

export default router;
