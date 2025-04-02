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
visitorRouter.post("/visitors", visitorController.createVisitor)
visitorRouter.get("/visitors", visitorController.getAllVisitors)
visitorRouter.get("/visitors/:id", visitorController.getVisitorsById)
visitorRouter.put("/visitors/:id", visitorController.updateVisitor)
visitorRouter.delete("/visitors/:id", visitorController.deleteVisitor)

//visitor routes
visitorRouter.post("/visit", visitController.createVisit)
visitorRouter.get("/visit", visitController.getAllVisits)
visitorRouter.get("/visit/:id", visitController.getVisitById)
visitorRouter.put("/visit/:id", visitController.updateVisit)
visitorRouter.delete("/visit/:id", visitController.deleteVisits)
visitorRouter.put("/visit/visitor/:id", visitController.getAllVisitsByVisitorsId)

//follow ups
visitorRouter.post("/followup", followUpController.createFollowUp)
visitorRouter.get("/followup", followUpController.getAllFollowUps)
visitorRouter.get("/followup/:id", followUpController.getFollowUpById)
visitorRouter.put("/followup/:id", followUpController.updateFollowUp)
visitorRouter.delete("/followup/:id", followUpController.deleteFollowUp)

//prayer request
visitorRouter.post("/prayerrequest", prayerRequestController.createPrayerRequest)
visitorRouter.get("/prayerrequest", prayerRequestController.getAllPrayerRequests)
visitorRouter.get("/prayerrequest/:id", prayerRequestController.getPrayerRequestById)
visitorRouter.put("/prayerrequest/:id", prayerRequestController.updatePrayerRequest)
visitorRouter.delete("/prayerrequest/:id", prayerRequestController.deletePrayerRequest)


export default visitorRouter
