import { Request, Response } from "express";
import { UnauthorizedError } from "../../utils/custom-error-handlers";
import * as rides from "./rideService";
import { toPositiveInt } from "./rideHelpers";

/**
 * Thin HTTP layer over rideService. Business-rule failures are thrown as
 * AppErrors and shaped by the global error handler (express-async-errors
 * forwards the async throws).
 */
const userIdOf = (req: Request): number => {
  const id = toPositiveInt((req as any)?.user?.id);
  if (!id) throw new UnauthorizedError("Not authorized");
  return id;
};

const ok = (res: Response, data: unknown, message = "Success") =>
  res.status(200).json({ message, data });

/* Member-facing */

export const getCatalog = async (req: Request, res: Response) =>
  ok(res, await rides.getCatalog(userIdOf(req)));

export const getMyRide = async (req: Request, res: Response) =>
  ok(res, await rides.getMyRide(userIdOf(req)));

export const searchRides = async (req: Request, res: Response) =>
  ok(res, await rides.searchRides(userIdOf(req), req.query?.pickup_point_id));

export const publishOffer = async (req: Request, res: Response) =>
  ok(res, await rides.publishOffer(userIdOf(req), req.body), "Your ride is published");

export const cancelOffer = async (req: Request, res: Response) =>
  ok(res, await rides.cancelOffer(userIdOf(req), req.params.id), "Ride cancelled");

export const requestSeat = async (req: Request, res: Response) =>
  ok(res, await rides.requestSeat(userIdOf(req), req.body), "Request sent");

export const acceptRequest = async (req: Request, res: Response) =>
  ok(res, await rides.acceptRequest(userIdOf(req), req.params.id), "Request accepted");

export const declineRequest = async (req: Request, res: Response) =>
  ok(res, await rides.declineRequest(userIdOf(req), req.params.id, req.body), "Request declined");

export const cancelRequest = async (req: Request, res: Response) =>
  ok(res, await rides.cancelRequest(userIdOf(req), req.params.id), "Request cancelled");

export const dismissRequest = async (req: Request, res: Response) =>
  ok(res, await rides.dismissRequest(userIdOf(req), req.params.id));

export const setPickupAlert = async (req: Request, res: Response) =>
  ok(res, await rides.setPickupAlert(userIdOf(req), req.body));

export const fileReport = async (req: Request, res: Response) =>
  ok(res, await rides.fileReport(userIdOf(req), req.body), "Report sent to the safety team");

/* Safety team / church office */

export const listReports = async (req: Request, res: Response) =>
  ok(res, await rides.listReports(userIdOf(req), req.query?.status));

export const resolveReport = async (req: Request, res: Response) =>
  ok(res, await rides.resolveReport(userIdOf(req), req.params.id, req.body), "Report resolved");

export const getAdminCatalog = async (req: Request, res: Response) =>
  ok(res, await rides.getAdminCatalog(userIdOf(req)));

export const savePickupPoint = async (req: Request, res: Response) =>
  ok(res, await rides.savePickupPoint(userIdOf(req), req.params.id, req.body), "Pickup point saved");

export const saveArea = async (req: Request, res: Response) =>
  ok(res, await rides.saveArea(userIdOf(req), req.params.id, req.body), "Area saved");
