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
visitorRouter.post(
  "/visitors",
  [protect, permissions.can_manage_visitors_scoped],
  visitorController.createVisitor,
);
visitorRouter.get(
  "/visitors",
  [protect, permissions.can_view_visitors_scoped],
  visitorController.getAllVisitors,
);
visitorRouter.get(
  "/visitor",
  [protect, permissions.can_view_visitors_scoped],
  visitorController.getVisitorsById,
);
visitorRouter.put(
  "/visitor",
  [protect, permissions.can_manage_visitors_scoped],
  visitorController.updateVisitor,
);
visitorRouter.delete(
  "/visitor",
  [protect, permissions.can_delete_visitors_scoped],
  visitorController.deleteVisitor,
);
visitorRouter.post(
  "/convert-to-member",
  [protect, permissions.can_manage_member_details],
  visitorController.convertVisitorToMember,
);

//visitor routes
visitorRouter.post(
  "/visit",
  [protect, permissions.can_manage_visitor_visits_scoped],
  visitController.createVisit,
);
visitorRouter.get(
  "/visits",
  [protect, permissions.can_view_visitor_visits_scoped],
  visitController.getAllVisits,
);
visitorRouter.get(
  "/visit",
  [protect, permissions.can_view_visitor_visits_scoped],
  visitController.getVisitById,
);
visitorRouter.put(
  "/visit",
  [protect, permissions.can_manage_visitor_visits_scoped],
  visitController.updateVisit,
);
visitorRouter.delete(
  "/visit",
  [protect, permissions.can_delete_visitors_scoped],
  visitController.deleteVisits,
);
visitorRouter.get(
  "/visit/visitor",
  [protect, permissions.can_view_visitors_scoped],
  visitController.getAllVisitsByVisitorsId,
);

//follow ups
visitorRouter.post(
  "/followup",
  [protect, permissions.can_manage_visitor_followups_scoped],
  followUpController.createFollowUp,
);
visitorRouter.get(
  "/followups",
  [protect, permissions.can_view_visitor_followups_scoped],
  followUpController.getAllFollowUps,
);
visitorRouter.get(
  "/followup",
  [protect, permissions.can_view_visitor_followups_scoped],
  followUpController.getFollowUpById,
);
visitorRouter.put(
  "/followup",
  [protect, permissions.can_manage_visitor_followups_scoped],
  followUpController.updateFollowUp,
);
visitorRouter.delete(
  "/followup",
  [protect, permissions.can_delete_visitors_scoped],
  followUpController.deleteFollowUp,
);

//prayer request
visitorRouter.post(
  "/prayerrequest",
  [protect, permissions.can_manage_visitor_prayer_requests_scoped],
  prayerRequestController.createPrayerRequest,
);
visitorRouter.get(
  "/prayerrequests",
  [protect, permissions.can_view_visitor_prayer_requests_scoped],
  prayerRequestController.getAllPrayerRequests,
);
visitorRouter.get(
  "/prayerrequest",
  [protect, permissions.can_view_visitor_prayer_requests_scoped],
  prayerRequestController.getPrayerRequestById,
);
visitorRouter.put(
  "/prayerrequest",
  [protect, permissions.can_manage_visitor_prayer_requests_scoped],
  prayerRequestController.updatePrayerRequest,
);
visitorRouter.delete(
  "/prayerrequest",
  [protect, permissions.can_delete_visitors_scoped],
  prayerRequestController.deletePrayerRequest,
);

export default visitorRouter;
