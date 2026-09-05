import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { promotionController } from "./promotionController";

const controller = new promotionController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();

// `/active` must be registered before `/:id` so it is not captured as an id.
router.get("/active", [protect], controller.active);

router.get("/", [protect, permissions.can_view_promotions], controller.list);
router.get(
  "/:id",
  [protect, permissions.can_view_promotions],
  controller.getOne,
);

router.post(
  "/",
  [protect, permissions.can_manage_promotions],
  controller.create,
);
router.put(
  "/:id",
  [protect, permissions.can_manage_promotions],
  controller.update,
);
router.post(
  "/:id/publish",
  [protect, permissions.can_manage_promotions],
  controller.publish,
);
router.post(
  "/:id/archive",
  [protect, permissions.can_manage_promotions],
  controller.archive,
);

router.delete(
  "/:id",
  [protect, permissions.can_delete_promotions],
  controller.remove,
);

export default router;
