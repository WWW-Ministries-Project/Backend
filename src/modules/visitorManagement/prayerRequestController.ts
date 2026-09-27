import { Request, Response } from "express";
import { PrayerRequestService } from "./prayerRequestService";

const prayerRequestService = new PrayerRequestService();

const MAX_PRAYER_REQUEST_LENGTH = 2000;

const getRequestUserId = (req: Request) => {
  const parsed = Number((req as any)?.user?.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export class PrayerRequestController {
  async createPrayerRequest(req: Request, res: Response) {
    try {
      const prayerRequest = await prayerRequestService.createPrayerRequest(
        req.body,
      );
      return res
        .status(201)
        .json({ message: "PrayerRequest Added", data: prayerRequest });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error creating PrayerRequest",
        error: error.message,
      });
    }
  }

  async getAllPrayerRequests(req: Request, res: Response) {
    try {
      const visitorScope = (req as any).visitorScope;
      const prayerRequest =
        await prayerRequestService.getAllPrayerRequests(visitorScope);
      return res.status(200).json({ data: prayerRequest });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching PrayerRequest",
        error: error.message,
      });
    }
  }

  async getPrayerRequestById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const prayerRequest = await prayerRequestService.getPrayerRequestById(
        Number(id),
      );
      if (!prayerRequest)
        return res.status(404).json({ message: "PrayerRequest not found" });

      return res.status(200).json({ data: prayerRequest });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching PrayerRequest",
        error: error.message,
      });
    }
  }

  async updatePrayerRequest(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const updatedPrayerRequest =
        await prayerRequestService.updatePrayerRequest(Number(id), req.body);
      return res
        .status(200)
        .json({ message: "PrayerRequest updated", data: updatedPrayerRequest });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating PrayerRequest",
        error: error.message,
      });
    }
  }

  async deletePrayerRequest(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await prayerRequestService.deletePrayerRequest(Number(id));
      return res
        .status(200)
        .json({ message: "PrayerRequest deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error deleting PrayerRequest",
        error: error.message,
      });
    }
  }

  /** GET /visitor/my-prayer-requests — the caller's own requests. */
  async listMyPrayerRequests(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    const data = await prayerRequestService.getPrayerRequestsForUser(userId);
    return res.status(200).json({ message: "Success", data });
  }

  /** POST /visitor/my-prayer-requests { request } — a member asks for prayer.
   *  Owned by the caller (userId from the token, never the body), so it shows
   *  up in the staff `/prayerrequests` list alongside visitor requests. */
  async createMyPrayerRequest(req: Request, res: Response) {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", data: null });
    }
    const request = typeof req.body?.request === "string" ? req.body.request.trim() : "";
    if (!request) {
      return res.status(400).json({ message: "request is required", data: null });
    }
    if (request.length > MAX_PRAYER_REQUEST_LENGTH) {
      return res.status(400).json({
        message: `request must be at most ${MAX_PRAYER_REQUEST_LENGTH} characters`,
        data: null,
      });
    }
    const data = await prayerRequestService.createPrayerRequestForUser(userId, request);
    return res.status(201).json({ message: "Prayer request received", data });
  }
}
