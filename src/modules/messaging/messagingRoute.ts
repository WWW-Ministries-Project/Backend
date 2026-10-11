import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import { messagingController as c } from "./messagingController";

const permissions = new Permissions();
const protect = permissions.protect;
const view = [protect, permissions.can_view_messaging];
const manage = [protect, permissions.can_manage_messaging];

const router = Router();

router.get("/templates", view, c.listTemplates);
router.put("/templates/:key", manage, c.updateTemplate);
router.get("/settings", view, c.getSettings);
router.put("/settings", manage, c.updateSettings);
router.get("/placeholders", view, c.placeholders);
router.post("/preview", view, c.preview);
router.post("/audience/count", manage, c.audienceCount);
router.get("/birthdays/upcoming", view, c.upcomingBirthdays);
router.get("/stats", view, c.stats);
router.post("/dispatches", manage, c.createDispatch);
router.get("/dispatches", view, c.listDispatches);
router.get("/dispatches/:id", view, c.getDispatch);
router.get("/dispatches/:id/recipients", view, c.listRecipients);
router.post("/dispatches/:id/cancel", manage, c.cancel);
router.post("/dispatches/:id/retry-failed", manage, c.retryFailed);

export default router;
