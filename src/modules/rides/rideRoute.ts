import Router from "express";
import {
  acceptRequest,
  adminCancelOffer,
  cancelOffer,
  cancelRequest,
  declineRequest,
  dismissRequest,
  fileReport,
  getAdminCatalog,
  getAdminOverview,
  getCatalog,
  getMyRide,
  listBlocks,
  listReports,
  publishOffer,
  removeBlock,
  requestSeat,
  resolveReport,
  saveArea,
  savePickupPoint,
  searchRides,
  setPickupAlert,
} from "./rideController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();
const protect = permissions.protect;

export const rideRouter = Router();

// Member-facing. Membership (not a guest, active account) and ownership are
// enforced per request in rideService — any signed-in member may share rides.
rideRouter.get("/catalog", [protect], getCatalog);
rideRouter.get("/mine", [protect], getMyRide);
rideRouter.get("/search", [protect], searchRides);
rideRouter.post("/offers", [protect], publishOffer);
rideRouter.post("/offers/:id/cancel", [protect], cancelOffer);
rideRouter.post("/requests", [protect], requestSeat);
rideRouter.post("/requests/:id/accept", [protect], acceptRequest);
rideRouter.post("/requests/:id/decline", [protect], declineRequest);
rideRouter.post("/requests/:id/cancel", [protect], cancelRequest);
rideRouter.post("/requests/:id/dismiss", [protect], dismissRequest);
rideRouter.post("/alerts", [protect], setPickupAlert);
rideRouter.post("/reports", [protect], fileReport);

// Safety team / church office: Rides actions (view_overview, cancel_any_offer,
// manage_pickup_points, resolve_safety_reports, lift_block, export_roster;
// Rides falls back to Membership_Management for levels saved before it
// existed), checked in the service on the live role for the active branch, so
// the same rule also picks who receives safety reports. withAccess resolves
// the caller's branch.
rideRouter.get("/admin/overview", [protect, permissions.withAccess], getAdminOverview);
rideRouter.post("/admin/offers/:id/cancel", [protect, permissions.withAccess], adminCancelOffer);
rideRouter.get("/admin/blocks", [protect, permissions.withAccess], listBlocks);
rideRouter.delete("/admin/blocks/:id", [protect, permissions.withAccess], removeBlock);
rideRouter.get("/admin/reports", [protect, permissions.withAccess], listReports);
rideRouter.patch("/admin/reports/:id/resolve", [protect, permissions.withAccess], resolveReport);
rideRouter.get("/admin/catalog", [protect, permissions.withAccess], getAdminCatalog);
rideRouter.post("/admin/pickup-points", [protect, permissions.withAccess], savePickupPoint);
rideRouter.put("/admin/pickup-points/:id", [protect, permissions.withAccess], savePickupPoint);
rideRouter.post("/admin/areas", [protect, permissions.withAccess], saveArea);
rideRouter.put("/admin/areas/:id", [protect, permissions.withAccess], saveArea);

export default rideRouter;
