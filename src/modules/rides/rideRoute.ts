import Router from "express";
import {
  acceptRequest,
  cancelOffer,
  cancelRequest,
  declineRequest,
  dismissRequest,
  fileReport,
  getAdminCatalog,
  getCatalog,
  getMyRide,
  listReports,
  publishOffer,
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

// Safety team / church office: Membership_Management managers, checked in the
// service so the same rule also picks who receives safety reports.
rideRouter.get("/admin/reports", [protect], listReports);
rideRouter.patch("/admin/reports/:id/resolve", [protect], resolveReport);
rideRouter.get("/admin/catalog", [protect], getAdminCatalog);
rideRouter.post("/admin/pickup-points", [protect], savePickupPoint);
rideRouter.put("/admin/pickup-points/:id", [protect], savePickupPoint);
rideRouter.post("/admin/areas", [protect], saveArea);
rideRouter.put("/admin/areas/:id", [protect], saveArea);

export default rideRouter;
