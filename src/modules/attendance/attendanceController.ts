import { Request, Response } from "express";
import { AtttendanceService } from "./attendanceService";

const attendanceServance = new AtttendanceService();

export class AtttendanceController {
  async getAttendance(req: Request, res: Response) {
    try {
      const date = req.body.date ? new Date(req.body.date) : new Date();

      const data = await attendanceServance.getAttendanceForAllUsers(date);

      return res.status(200).json({ message: true, data });
    } catch (error) {
      console.error("Error getting attendance:", error);
      return res
        .status(500)
        .json({ message: false, error: "Internal server error" });
    }
  }
}
