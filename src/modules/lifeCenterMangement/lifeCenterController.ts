import { Request, Response } from "express";
import { LifeCenterService } from "./lifeCenterService";

const lifeCenterService = new LifeCenterService();

export class LifeCenterController {
  async mylifecenter(req: Request, res: Response) {
  try {
    const { id } = req.query;

    // Validate ID
    if (!id || isNaN(parseInt(id as string))) {
      return res.status(400).json({ message: "Invalid or missing user ID" });
    }

    const lifeCenter = await lifeCenterService.getMyLifeCenter(Number(id));

    if (!lifeCenter) {
      return res.status(404).json({ message: "User is not assigned to any Life Center" });
    }

    return res.status(200).json({
      message: "Operation successful",
      data: lifeCenter,
    });

  } catch (error: any) {
    return res.status(500).json({
      message: "Error fetching my life center",
      error: error.message,
    });
  }
}
  
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
    const userId = Number(req.query.userId);
    const lifeCenterId = Number(req.query.lifeCenterId);

    if (isNaN(userId) || isNaN(lifeCenterId)) {
      return res.status(400).json({
        message: "userId and lifeCenterId are required and must be valid numbers",
      });
    }

    const data = { userId, lifeCenterId };

    const member = await lifeCenterService.removeMemberFromLifeCenter(data);

    return res.status(200).json({
      message: "Operation successful",
      data: member,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}

  async getAllLifeCenterMembers(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const members = await lifeCenterService.getAllLifeCenterMembers(
        Number(id),
      );

      res.status(201).json({ message: "Operation successfull", data: members });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSouls(req: Request, res: Response) {
    try {
      const { lifeCenterId, wonById } = req.query;

      const filter: {
        lifeCenterId?: number;
        wonById?: number;
      } = {};

      if (lifeCenterId) filter.lifeCenterId = Number(lifeCenterId);
      if (wonById) filter.wonById = Number(wonById);

      const souls = await lifeCenterService.getSouls(filter);

      res.status(200).json({ message: "Operation successful", data: souls });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSoul(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const soul = await lifeCenterService.getSoul(Number(id));

      const returningSoul = {
        ...soul,
        phone:{
          number: soul.contact_number,
          country_code:soul.country_code
        }
      }

      res.status(200).json({ message: "Operation successful", data: returningSoul });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async removeSoulWon(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const soul = await lifeCenterService.removeSoul(Number(id));

      res.status(200).json({ message: "Operation successful", data: soul });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createSoulWon(req: Request, res: Response) {
    try {
      const {
        title,
        first_name,
        last_name,
        other_name,
        phone,
        contact_email,
        country,
        city,
        date_won,
        wonById,
        lifeCenterId,
      } = req.body;

      const newSoul = await lifeCenterService.createSoulWon({
        title,
        first_name,
        last_name,
        other_name,
        contact_number:phone.number,
        country_code:phone.country_code,
        contact_email,
        country,
        city,
        date_won: new Date(date_won),
        wonById: Number(wonById),
        lifeCenterId: Number(lifeCenterId),
      });

      const returningSoul = {
        id: newSoul.id,
        title:newSoul.title,
        first_name: newSoul.first_name,
        last_name: newSoul.last_name,
        other_name: newSoul.other_name,
        phone :{
          number: newSoul.contact_number,
          country_code : newSoul.country_code,
        },
        contact_email: newSoul.contact_email,
        country: newSoul.country,
        city: newSoul.city,
        date_won: newSoul.date_won,
        wonById: newSoul.wonById,
        lifeCenterId: newSoul.lifeCenterId,
      };

      return res
        .status(201)
        .json({ message: "Soul won record created", data: returningSoul });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error creating soul won record",
        error: error.message,
      });
    }
  }
 async updateSoulWon(req: Request, res: Response) {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ message: "Missing soul ID" });

      const {
        title,
        first_name,
        last_name,
        other_name,
        phone,
        contact_email,
        country,
        city,
        date_won,
        wonById,
        lifeCenterId,
      } = req.body;


      const updated = await lifeCenterService.updateSoulWon(Number(id), {
        title,
        first_name,
        last_name,
        other_name,
        contact_number:phone.number,
        country_code:phone.country_code,
        contact_email,
        country,
        city,
        date_won: new Date(date_won),
        wonById: Number(wonById),
        lifeCenterId: Number(lifeCenterId),
      });

      const updatedSoul = {
        id: updated.id,
        first_name: updated.first_name,
        last_name: updated.last_name,
        other_name: updated.other_name,
        phone :{
          number: updated.contact_number,
          country_code : updated.country_code,
        },
        contact_email: updated.contact_email,
        country: updated.country,
        city: updated.city,
        date_won: updated.date_won,
        wonById: updated.wonById,
        lifeCenterId: updated.lifeCenterId,
      };

      return res.status(200).json({
        message: "Soul won record updated",
        data: updatedSoul,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating soul won record",
        error: error.message,
      });
    }
  }

  async getStats(req:Request, res: Response) {
    try {
      
       const response = await lifeCenterService.getLifeCenterStats()
    

      return res.status(200).json({
        message: "Operation sucessfull",
        data: response,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating soul won record",
        error: error.message,
      });
    }
  }
}
