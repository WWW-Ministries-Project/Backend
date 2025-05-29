import { Request, Response } from "express";
import { FollowUpService } from "./followUpService";

const follow_up = new FollowUpService();

export class FollowUPController {
  async createFollowUp(req: Request, res: Response) {
    try {
      const { date, type, assignedTo, notes, visitorId } = req.body;

      const dateObject = new Date(date);

      const followUpData = {
        date: dateObject,
        type,
        assignedTo: Number(assignedTo),
        notes,
        visitorId: Number(visitorId),
      };

      const follow = await follow_up.createFollowUp(followUpData);
      return res.status(201).json({ message: "Follow Up Added", data: follow });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error creating follow up", error: error.message });
    }
  }

  async getAllFollowUps(req: Request, res: Response) {
    try {
      const follows = await follow_up.getAllFollowUps();
      return res.status(200).json({ data: follows });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching followups", error: error.message });
    }
  }

  async getFollowUpById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const follow = await follow_up.getFollowUpById(Number(id));
      if (!follow)
        return res.status(404).json({ message: "Follow Up not found" });

      return res.status(200).json({ data: follow });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching Follow Up", error: error.message });
    }
  }

  async updateFollowUp(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const updatedfollowup = await follow_up.updateFollowUp(
        Number(id),
        req.body,
      );
      return res
        .status(200)
        .json({ message: "Follow Up updated", data: updatedfollowup });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error updating Follow Up", error: error.message });
    }
  }

  async deleteFollowUp(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await follow_up.deleteFollowUp(Number(id));
      return res
        .status(200)
        .json({ message: "Follow Up deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting Follow Up", error: error.message });
    }
  }
}
