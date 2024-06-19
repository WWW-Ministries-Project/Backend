import { generateQR } from "../utils/qr-codeGenerator";
import { prisma } from "./../Models/context";
import { Request, Response } from "express";
import * as dotenv from "dotenv";
dotenv.config();

export class eventManagement {
  createEvent = async (req: Request, res: Response) => {
    try {
      const {
        name,
        start_date,
        end_date,
        start_time,
        end_time,
        location,
        description,
        poster,
        created_by,
      } = req.body;

      const response = await prisma.event_mgt.create({
        data: {
          name,
          start_date: new Date(start_date),
          end_date: new Date(end_date),
          start_time,
          end_time,
          location,
          description,
          poster,
          created_by,
        },
        select: {
          id: true,
          name: true,
          start_date: true,
          end_date: true,
          start_time: true,
          end_time: true,
          location: true,
          description: true,
          poster: true,
          qr_code: true,
        },
      });

      const qr_code = await generateQR(
        `${process.env.Frontend_URL}/events/register-event?event_id=${response.id}&event_name=${response.name}`
      );

      await prisma.event_mgt.update({
        where: {
          id: response.id,
        },
        data: {
          qr_code,
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
        start_date,
        end_date,
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
          start_date: new Date(start_date),
          end_date: new Date(end_date),
          start_time,
          end_time,
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
          start_date: true,
          end_date: true,
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
            { start_date: { gte: new Date(`${year}-${month}-01`) } }, // Start of the month
            { start_date: { lt: new Date(`${year}-${Number(month) + 1}-01`) } }, // Start of the next month
          ],
        },
        orderBy: {
          start_date: "asc",
        },
      });
      res.status(200).json({
        message: "Operation successful",
        data: month ? data : await this.listEventsP(),
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
        select: {
          id: true,
          name: true,
          poster: true,
          start_date: true,
          end_date: true,
          start_time: true,
          end_time: true,
          qr_code: true,
          location: true,
          description: true,
          created_by: true,
          event_attendance: {
            select: {
              created_at: true,
              user: {
                select: {
                  user_info: {
                    select: {
                      first_name: true,
                      last_name: true,
                      other_name: true,
                      primary_number: true,
                    },
                  },
                },
              },
            },
          },
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

  eventAttendance = async (req: Request, res: Response) => {
    try {
      const {
        first_name,
        last_name,
        other_name,
        gender,
        marital_status,
        membership_type,
        country_code,
        title,
        phone_number,
        new_member,
      } = req.body;
      const { event_id } = req.query;

      // If not a new User
      if (!new_member) {
        const existing_user: any = await this.searchUser(
          phone_number,
          country_code
        );
        if (!existing_user) {
          return res.status(204).json({
            message: "User not found",
          });
        }
        // Check for already capured users
        const checkSign = await this.checkSign(event_id, existing_user.user_id);
        if (checkSign) {
          return res.status(204).json({
            message: "Already Captured, Enjoy the program",
          });
        }

        // Signing Attendace
        this.signAttendance(event_id, existing_user.user_id);
        return res.status(200).json({
          message: "Attendance recorded successfully",
        });
      }

      const existing_user: any = await this.searchUser(
        phone_number,
        country_code
      );
      if (existing_user) {
        return res.status(200).json({
          message: "Already a user",
        });
      }

      const create_user = await prisma.user.create({
        data: {
          name: `${first_name} ${other_name} ${last_name}`,
          membership_type,
          user_info: {
            create: {
              gender,
              first_name,
              last_name,
              other_name,
              title,
              marital_status,
              country_code,
              primary_number: phone_number,
            },
          },
        },
        select: {
          id: true,
        },
      });

      await this.signAttendance(event_id, create_user.id);

      res.status(200).json({
        message: "Attendance recorded successfully",
      });
    } catch (error) {
      return res.status(500).json({
        message: "Something went wrong",
        data: error,
      });
    }
  };

  searchUser1 = async (req: Request, res: Response) => {
    try {
      const { country_code, phone }: any = req.query;
      const existing_user: any = await this.searchUser(phone, country_code);
      if (!existing_user) {
        return res.status(204).json({
          message: "User not found",
        });
      } else {
        return res.status(200).json({
          message: "User found",
          data: existing_user,
        });
      }
    } catch (error) {
      return res.status(500).json({
        message: "Something went wrong",
        data: error,
      });
    }
  };

  private async checkSign(event_id: any, user_id: any) {
    return await prisma.event_attendance.findFirst({
      where: {
        AND: {
          event_id: Number(event_id),
          user_id: Number(user_id),
        },
      },
      select: {
        id: true,
      },
    });
  }

  private async signAttendance(event_id: any, user_id: any) {
    try {
      await prisma.event_attendance.create({
        data: {
          event_id: Number(event_id),
          user_id: Number(user_id),
        },
      });
    } catch (error) {
      return error;
    }
  }

  private async searchUser(phone: string, code: string) {
    try {
      return await prisma.user_info.findFirst({
        where: {
          AND: {
            primary_number: phone,
            country_code: `+${code}`,
          },
        },
        select: {
          first_name: true,
          last_name: true,
          other_name: true,
          primary_number: true,
          user_id: true,
        },
      });
    } catch (error) {
      return "User Not Found";
    }
  }

  private async listEventsP() {
    try {
      return await prisma.event_mgt.findMany({
        orderBy: {
          start_date: "asc",
        },
      });
    } catch (error) {
      return error;
    }
  }
}
