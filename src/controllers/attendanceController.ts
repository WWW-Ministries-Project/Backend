import { AttendanceModel } from "../Models/attendance";
import { Request, Response } from "express";

export const markAttendance = async (req: Request, res: Response) => {
  const { member_id } = req.body;
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set hours, minutes, seconds, and milliseconds to 0

  try {
    const existingAttendance = await AttendanceModel.findOne({
      member_id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000), // Add 24 hours to currentDate
      },
    });

    if (existingAttendance) {
      return res.status(409).send("Member ID already recorded for today");
    }

    const response = await AttendanceModel.create({
      member_id,
      date: new Date(),
    });

    res.status(200).json("Attendance marked successfully");
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation not successful");
    }
    throw error.message;
  }
};

export const getAllattendance = async (req: Request, res: Response) => {
  try {
    const response = await AttendanceModel.find();
    res.json(response).status(200);
  } catch (error) {
    if (error) {
      return res.status(409).send("Operation Not Successful");
    }
  }
};

export const getDateattendance = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.body;
  try {
    const response = await AttendanceModel.find({
      date: { $gte: startDate, $lt: endDate },
    });
    res.json(response).status(200);
  } catch (error) {
    res.send(error);
  }
};
