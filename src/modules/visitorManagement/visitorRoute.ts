import { Router } from "express";

import { Permissions } from "../../middleWare/authorization";
import { VisitorController } from "./visitorController";
import { VisitController } from "./visitController";
import { FollowUPController } from "./followUpController";
import { PrayerRequestController } from "./prayerRequestController";
import { MemberVisitorController } from "./memberVisitorController";
import {
  checkVisitorRecord,
  requireAssignResponsibleWhenChanged,
  requireConvertVisitor,
  requireVisitorAction,
  scopeVisitors,
} from "./visitorAccess";
const permissions = new Permissions();
const protect = permissions.protect;

const visitorRouter = Router();
const visitorController = new VisitorController();
const visitController = new VisitController();
const followUpController = new FollowUPController();
const prayerRequestController = new PrayerRequestController();
const memberVisitorController = new MemberVisitorController();

//visitor routes
visitorRouter.post(
  "/visitors",
  [
    protect,
    permissions.can_manage_visitors_scoped,
    requireVisitorAction("log_visit", "Not authorized to record visitors"),
    requireAssignResponsibleWhenChanged,
  ],
  visitorController.createVisitor,
);
visitorRouter.get(
  "/visitors",
  [protect, permissions.can_view_visitors_scoped, scopeVisitors],
  visitorController.getAllVisitors,
);
visitorRouter.get(
  "/visitor",
  [protect, permissions.can_view_visitors_scoped, checkVisitorRecord("visitor")],
  visitorController.getVisitorsById,
);
visitorRouter.put(
  "/visitor",
  [
    protect,
    permissions.can_manage_visitors_scoped,
    checkVisitorRecord("visitor"),
    requireAssignResponsibleWhenChanged,
  ],
  visitorController.updateVisitor,
);
visitorRouter.delete(
  "/visitor",
  [
    protect,
    permissions.can_delete_visitors_scoped,
    requireVisitorAction("delete", "Not authorized to delete visitors"),
    checkVisitorRecord("visitor"),
  ],
  visitorController.deleteVisitor,
);
visitorRouter.post(
  "/convert-to-member",
  [
    protect,
    permissions.requireAction("Members", "create", "Not authorized to add members"),
    requireConvertVisitor,
    checkVisitorRecord("visitor"),
  ],
  visitorController.convertVisitorToMember,
);

//visitor routes
visitorRouter.post(
  "/visit",
  [
    protect,
    permissions.can_manage_visitor_visits_scoped,
    requireVisitorAction("log_visit", "Not authorized to log visits"),
    checkVisitorRecord("visit"),
  ],
  visitController.createVisit,
);
visitorRouter.get(
  "/visits",
  [protect, permissions.can_view_visitor_visits_scoped, scopeVisitors],
  visitController.getAllVisits,
);
visitorRouter.get(
  "/visit",
  [protect, permissions.can_view_visitor_visits_scoped, checkVisitorRecord("visit")],
  visitController.getVisitById,
);
visitorRouter.put(
  "/visit",
  [
    protect,
    permissions.can_manage_visitor_visits_scoped,
    requireVisitorAction("log_visit", "Not authorized to log visits"),
    checkVisitorRecord("visit"),
  ],
  visitController.updateVisit,
);
visitorRouter.delete(
  "/visit",
  [
    protect,
    permissions.can_delete_visitors_scoped,
    requireVisitorAction("delete", "Not authorized to delete visits"),
    checkVisitorRecord("visit"),
  ],
  visitController.deleteVisits,
);
visitorRouter.get(
  "/visit/visitor",
  [protect, permissions.can_view_visitors_scoped, checkVisitorRecord("visitor")],
  visitController.getAllVisitsByVisitorsId,
);

//follow ups
visitorRouter.post(
  "/followup",
  [
    protect,
    permissions.can_manage_visitor_followups_scoped,
    requireVisitorAction("record_follow_up", "Not authorized to record follow-ups"),
    checkVisitorRecord("follow_up"),
  ],
  followUpController.createFollowUp,
);
visitorRouter.get(
  "/followups",
  [protect, permissions.can_view_visitor_followups_scoped, scopeVisitors],
  followUpController.getAllFollowUps,
);
visitorRouter.get(
  "/followup",
  [protect, permissions.can_view_visitor_followups_scoped, checkVisitorRecord("follow_up")],
  followUpController.getFollowUpById,
);
visitorRouter.put(
  "/followup",
  [
    protect,
    permissions.can_manage_visitor_followups_scoped,
    requireVisitorAction("record_follow_up", "Not authorized to record follow-ups"),
    checkVisitorRecord("follow_up"),
  ],
  followUpController.updateFollowUp,
);
visitorRouter.delete(
  "/followup",
  [
    protect,
    permissions.can_delete_visitors_scoped,
    requireVisitorAction("delete", "Not authorized to delete follow-ups"),
    checkVisitorRecord("follow_up"),
  ],
  followUpController.deleteFollowUp,
);

//prayer request
// Member-facing: any signed-in member may read and submit their own.
visitorRouter.get(
  "/my-prayer-requests",
  [protect],
  prayerRequestController.listMyPrayerRequests,
);
visitorRouter.post(
  "/my-prayer-requests",
  [protect],
  prayerRequestController.createMyPrayerRequest,
);
// Member-facing, ownership-scoped: only visitors/follow-ups the caller is responsible for.
visitorRouter.get("/my-visitors", [protect], memberVisitorController.listMyVisitors);
visitorRouter.get("/my-follow-ups", [protect], memberVisitorController.listMyFollowUps);
visitorRouter.put("/my-follow-up", [protect], memberVisitorController.updateMyFollowUp);
visitorRouter.post("/my-follow-up", [protect], memberVisitorController.createMyFollowUp);
visitorRouter.post("/my-visit-note", [protect], memberVisitorController.addMyVisitNote);
visitorRouter.post(
  "/prayerrequest",
  [
    protect,
    permissions.can_manage_visitor_prayer_requests_scoped,
    requireVisitorAction("manage_prayer_requests", "Not authorized to manage prayer requests"),
    checkVisitorRecord("prayer_request"),
  ],
  prayerRequestController.createPrayerRequest,
);
visitorRouter.get(
  "/prayerrequests",
  [protect, permissions.can_view_visitor_prayer_requests_scoped, scopeVisitors],
  prayerRequestController.getAllPrayerRequests,
);
visitorRouter.get(
  "/prayerrequest",
  [
    protect,
    permissions.can_view_visitor_prayer_requests_scoped,
    checkVisitorRecord("prayer_request"),
  ],
  prayerRequestController.getPrayerRequestById,
);
visitorRouter.put(
  "/prayerrequest",
  [
    protect,
    permissions.can_manage_visitor_prayer_requests_scoped,
    requireVisitorAction("manage_prayer_requests", "Not authorized to manage prayer requests"),
    checkVisitorRecord("prayer_request"),
  ],
  prayerRequestController.updatePrayerRequest,
);
visitorRouter.delete(
  "/prayerrequest",
  [
    protect,
    permissions.can_delete_visitors_scoped,
    requireVisitorAction("delete", "Not authorized to delete prayer requests"),
    checkVisitorRecord("prayer_request"),
  ],
  prayerRequestController.deletePrayerRequest,
);

export default visitorRouter;
