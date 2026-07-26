import Router from "express";
import * as dotenv from "dotenv";
import { Permissions } from "../../middleWare/authorization";
import { sermonController } from "./sermonController";

const controller = new sermonController();
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

const router = Router();

// Open to any authenticated member: viewing published sermons requires no
// Sermons permission. Management routes below stay permission-gated.
router.get("/", [protect], controller.list);
router.get("/:id", [protect], controller.getOne);

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
