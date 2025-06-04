import { Request, Response } from "express";
import { LifeCenterService } from "./lifeCenterService";

const lifeCenterService = new LifeCenterService();

export class LifeCenterController {
  async createLifeCenter(req: Request, res: Response) {
    try {
      const { name, description, location, meeting_dates } = req.body;

      const meetingDays = Array.isArray(meeting_dates)
        ? meeting_dates.join(", ")
        : "";

      const data = {
        name,
        description,
        meetingLocation: location,
        meetingDays,
      };

      const newLifeCenter = await lifeCenterService.create(data);

      return res.status(201).json({
        message: "Life center added successfully",
        data: newLifeCenter,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error creating life center",
        error: error.message,
      });
    }
  }

  async getAllLifeCenters(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const lifeCenters = await lifeCenterService.getAllLifeCenters();
      return res
        .status(200)
        .json({ message: "Operation sucessful", data: lifeCenters });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching life centers", error: error.message });
    }
  }

  async getLifeCenterById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const lifeCenter = await lifeCenterService.getLifeCenterById(Number(id));
      if (!lifeCenter)
        return res.status(404).json({ message: "life center not found" });

      return res.status(200).json({ data: lifeCenter });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching life center", error: error.message });
    }
  }

  async updateLifeCenter(req: Request, res: Response) {
    try {
      const id = Number(req.query.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid Life Center ID" });
      }

      const { name, description, location, meeting_dates } = req.body;

      const meetingDays = Array.isArray(meeting_dates)
        ? meeting_dates.join(", ")
        : "";

      const data = {
        name,
        description,
        meetingLocation: location,
        meetingDays,
      };

      const updatedLifeCenter = await lifeCenterService.updateLifeCenter(
        id,
        data,
      );

      return res.status(200).json({
        message: "Life Center updated",
        data: updatedLifeCenter,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating Life Center",
        error: error.message,
      });
    }
  }

  async deleteLifeCenter(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await lifeCenterService.deleteLifeCenter(Number(id));
      return res
        .status(200)
        .json({ message: "Life center deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting life center", error: error.message });
    }
  }

  async addMemberToLifeCenter(req: Request, res: Response) {
    try {
      const { userId, lifeCenterId, roleId } = req.body;

      const data = {
        userId: Number(userId),
        lifeCenterId: Number(lifeCenterId),
        roleId: Number(roleId),
      };

      const member = await lifeCenterService.addMemberToLifeCenter(data);

      res.status(201).json(member);
    } catch (error: any) {
      if (error.code === "P2002") {
        res
          .status(400)
          .json({ message: "Member already exists in this Life Center" });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  async updateMemberRole(req: Request, res: Response) {
    try {
      const { userId, lifeCenterId, roleId } = req.body;

      const data = {
        userId: Number(userId),
        lifeCenterId: Number(lifeCenterId),
        roleId: Number(roleId),
      };

      const member = await lifeCenterService.updateMemberRole(data);

      res.status(201).json({ message: "Operation successfull", data: member });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async removeMemberFromLifeCenter(req: Request, res: Response) {
    try {
      const { userId, lifeCenterId } = req.body;

      const data = {
        userId: Number(userId),
        lifeCenterId: Number(lifeCenterId),
      };

      const member = await lifeCenterService.removeMemberFromLifeCenter(data);

      res.status(201).json({ message: "Operation successfull", data: member });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
