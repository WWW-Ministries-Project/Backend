import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { VisitorController } from "./visitorController";
import { VisitController } from "./visitController";
import { FollowUPController } from "./followUpController";
import { PrayerRequestController } from "./prayerRequestController";
const permissions = new Permissions();
const protect = permissions.protect;

const visitorRouter = Router();
const visitorController = new VisitorController();
const visitController = new VisitController();
const followUpController = new FollowUPController();
const prayerRequestController = new PrayerRequestController();

//visitor routes
visitorRouter.post("/visitors", visitorController.createVisitor);
visitorRouter.get("/visitors", visitorController.getAllVisitors);
visitorRouter.get("/visitor", visitorController.getVisitorsById);
visitorRouter.put("/visitor", visitorController.updateVisitor);
visitorRouter.delete("/visitor", visitorController.deleteVisitor);

//visitor routes
visitorRouter.post("/visit", visitController.createVisit);
visitorRouter.get("/visits", visitController.getAllVisits);
visitorRouter.get("/visit", visitController.getVisitById);
visitorRouter.put("/visit", visitController.updateVisit);
visitorRouter.delete("/visit", visitController.deleteVisits);
visitorRouter.get("/visit/visitor", visitController.getAllVisitsByVisitorsId);

//follow ups
visitorRouter.post("/followup", followUpController.createFollowUp);
visitorRouter.get("/followups", followUpController.getAllFollowUps);
visitorRouter.get("/followup", followUpController.getFollowUpById);
visitorRouter.put("/followup", followUpController.updateFollowUp);
visitorRouter.delete("/followup", followUpController.deleteFollowUp);

//prayer request
visitorRouter.post(
  "/prayerrequest",
  prayerRequestController.createPrayerRequest,
);
visitorRouter.get(
  "/prayerrequests",
  prayerRequestController.getAllPrayerRequests,
);
visitorRouter.get(
  "/prayerrequest",
  prayerRequestController.getPrayerRequestById,
);
visitorRouter.put(
  "/prayerrequest",
  prayerRequestController.updatePrayerRequest,
);
visitorRouter.delete(
  "/prayerrequest",
  prayerRequestController.deletePrayerRequest,
);

export default visitorRouter;
