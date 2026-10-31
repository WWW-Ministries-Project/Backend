import Router from "express";
import { Permissions } from "../../middleWare/authorization";
import { messagingController as c } from "./messagingController";

const permissions = new Permissions();
const protect = permissions.protect;
const view = [protect, permissions.can_view_messaging];
// Writes need Messaging view at the route; the service then checks the
// action each request uses (send_sms, schedule, edit_templates, …) and the
// audience scope (src/modules/messaging/messagingAccess.ts).
const act = view;

const router = Router();

router.get("/access", view, c.access);
router.get("/templates", view, c.listTemplates);
router.put("/templates/:key", act, c.updateTemplate);
router.get("/settings", view, c.getSettings);
router.put("/settings", act, c.updateSettings);
router.get("/placeholders", view, c.placeholders);
router.post("/preview", view, c.preview);
router.post("/audience/count", act, c.audienceCount);
router.get("/birthdays/upcoming", view, c.upcomingBirthdays);
router.get("/stats", view, c.stats);
router.get("/overview", view, c.overview);
router.post("/dispatches", act, c.createDispatch);
router.get("/dispatches", view, c.listDispatches);
router.get("/dispatches/:id", view, c.getDispatch);
router.get("/dispatches/:id/recipients", view, c.listRecipients);
router.post("/dispatches/:id/cancel", act, c.cancel);
router.post("/dispatches/:id/retry-failed", act, c.retryFailed);

export default router;
