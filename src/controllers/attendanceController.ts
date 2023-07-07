import { AttendanceModel } from "../Models/attendance";
import { Request, Response } from "express";

export const markAttendance = async (req: Request, res: Response) => {
  const { member_id } = req.body;
  try {
    const response = await AttendanceModel.create({
      member_id,
      date: new Date(),
    });
    res.status(200).json("Attendance marked Succesfully");
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation Not Successful");
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
  //   console.log(date);

  try {
    const response = await AttendanceModel.find({
      date: { $gte: startDate, $lt: endDate },
    });
    res.json(response).status(200);
  } catch (error) {
    res.send(error);
  }
};
