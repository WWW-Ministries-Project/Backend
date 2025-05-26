import { Request, Response } from "express";
import { PrayerRequestService } from "./prayerRequestService";

const prayerRequestService = new PrayerRequestService();

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
      const prayerRequest = await prayerRequestService.getAllPrayerRequests();
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
}
