import { generateQR } from "../utils/qr-codeGenerator";
import { prisma } from "./../Models/context";
import { Request, Response } from "express";
export class eventManagement {
  createEvent = async (req: Request, res: Response) => {
    try {
      const {
        name,
        date,
        start_time,
        end_time,
        location,
        description,
        poster,
        created_by,
      } = req.body;
      const qr_code = await generateQR("https://wwwministries.netlify.app/");

      const response = await prisma.event_mgt.create({
        data: {
          name,
          date: new Date(date),
          start_time: new Date(start_time),
          end_time: new Date(end_time),
          location,
          description,
          poster,
          qr_code,
          created_by,
        },
        select: {
          id: true,
          name: true,
          date: true,
          start_time: true,
          end_time: true,
          location: true,
          description: true,
          poster: true,
          qr_code: true,
        },
      });

      res.status(200).json({
        message: "Event Created Succesfully",
        data: await this.listEventsP(),
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Event failed to create",
        data: error.message,
      });
    }
  };

  updateEvent = async (req: Request, res: Response) => {
    try {
      const {
        id,
        name,
        date,
        start_time,
        end_time,
        location,
        description,
        poster,
        qr_code,
        updated_by,
      } = req.body;
      const response = await prisma.event_mgt.update({
        where: {
          id,
        },
        data: {
          name,
          date: new Date(date),
          start_time: new Date(start_time),
          end_time: new Date(end_time),
          location,
          description,
          poster,
          qr_code,
          updated_by,
          updated_at: new Date(),
        },
        select: {
          id: true,
          name: true,
          date: true,
          start_time: true,
          end_time: true,
          location: true,
          description: true,
          poster: true,
          qr_code: true,
          updated_by: true,
          updated_at: true,
        },
      });
      res.status(200).json({
        message: "Event Updated Succesfully",
        data: await this.listEventsP(),
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Event failed to update",
        data: error.message,
      });
    }
  };

  deleteEvent = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;
      const response = await prisma.event_mgt.delete({
        where: {
          id: Number(id),
        },
      });
      res.status(200).json({
        message: "Event Created Succesfully",
        data: await this.listEventsP(),
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Event failed to delete",
        data: error.message,
      });
    }
  };

  listEvents = async (req: Request, res: Response) => {
    try {
      const { month, year } = req.query;
      const data = await prisma.event_mgt.findMany({
        where: {
          AND: [
            { date: { gte: new Date(`${year}-${month}-01`) } }, // Start of the month
            { date: { lt: new Date(`${year}-${Number(month) + 1}-01`) } }, // Start of the next month
          ],
        },
        orderBy: {
          date: "asc",
        },
      });
      res.status(200).json({
        message: "Operation successful",
        data,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Event failed to load",
        data: error.message,
      });
    }
  };

  getEvent = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;
      const response = await prisma.event_mgt.findUnique({
        where: {
          id: Number(id),
        },
      });
      res.status(200).json({ message: "Operation successful", data: response });
    } catch (error: any) {
      return res.status(500).json({
        message: "Event failed to load",
        data: error.message,
      });
    }
  };

  private async listEventsP() {
    try {
      return await prisma.event_mgt.findMany({
        orderBy: {
          date: "asc",
        },
      });
    } catch (error) {
      return error;
    }
  }
}
