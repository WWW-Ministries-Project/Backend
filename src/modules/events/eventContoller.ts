import { generateQR, generateRecurringDates } from "../../utils";
import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import * as dotenv from "dotenv";
import { addDays } from "date-fns";
dotenv.config();

const selectQuery = {
  id: true,
  name: true,
  start_time: true,
  description: true,
  end_date: true,
  end_time: true,
  event_status: true,
  event_act_id: true, 
  event_type: true,
  location: true,
  poster: true,
  qr_code: true,
  start_date: true,
};

export class eventManagement {
  createEvent = async (req: Request, res: Response) => {
    try {
      let data = req.body;
      let { start_date, end_date, day_event, repetitive, recurring } = req.body;
      if (day_event === "multi" && repetitive === "no") {
        end_date = addDays(start_date, recurring.daysOfWeek);
        const data2 = generateRecurringDates(start_date, end_date, recurring);
        data2.map((new_date: string) => {
          data.start_date = new_date;
          this.createEventController(data);
        });
      } else if (day_event === "one" && repetitive === "no") {
        data.end_date = data.start_date;
        this.createEventController(data);
      } else if (day_event === "one" && repetitive === "yes") {
        const data2 = generateRecurringDates(start_date, end_date, recurring);
        data2.map((new_date: string) => {
          data.start_date = new_date;
          this.createEventController(data);
        });
      } else if (day_event === "multi" && repetitive === "yes") {
        const data2 = generateRecurringDates(start_date, end_date, recurring);
        data2.map((new_date: string) => {
          data.start_date = new_date;
          this.createEventController(data);
        });
      }

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
        event_status,
        event_type,
        updated_by,
      } = req.body;

      const existance = await prisma.event_mgt.findUnique({
        where: {
          id,
        },
        select: selectQuery,
      });

      if (!existance) {
        return res.status(400).json({ message: "No Event found", data: null });
      }

      const response = await prisma.event_mgt.update({
        where: {
          id,
        },
        data: {
          name: name ? name : existance.name,
          start_date: start_date ? new Date(start_date) : existance.start_date,
          end_date: end_date ? new Date(end_date) : existance.end_date,
          start_time: start_time ? start_date : existance.start_date,
          end_time: end_time ? end_time : existance.end_time,
          location: location ? location : existance.location,
          description: description ? description : existance.description,
          poster: poster ? poster : existance.poster,
          updated_by,
          event_type: event_type ? event_type : existance.event_type,
          event_status: event_status ? event_status : existance.event_status,
          updated_at: new Date(),
        },
        select: selectQuery,
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
      const { month, year, event_type, event_status }: any = req.query;
      const startOfMonth = new Date(year, month - 1, 1); // month is 0-based
      const startOfNextMonth = new Date(year, month, 1); // next month

      const data = await prisma.event_mgt.findMany({
        where: {
          AND: [
            { start_date: { gte: startOfMonth } },
            { end_date: { lt: startOfNextMonth } },
         ],
          event_type,
          event_status,
        },
        orderBy: {
          start_date: "asc",
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
          event_type: true,
          event_status: true,
          event_act_id: true,
          event_attendance: {
            select: {
              created_at: true,
              user: {
                select: {
                  user_info: {
                    select: {
                      user: {
                        select: {
                          name: true,
                          membership_type: true,
                        },
                      },
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
      res.status(200).json({
        message: "Operation successful",
        data: month ? data : await this.listEventsP(),
      });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({
        message: "Event failed to load",
        data: error.message,
      });
    }
  };

  listUpcomingEvents = async (req: Request, res: Response) => {
    try {
      const date1 = new Date();
      const data = await prisma.event_mgt.findMany({
        where: {
          AND: [
            {
              start_date: {
                gte: new Date(
                  `${date1.getFullYear()}-${
                    date1.getMonth() + 1
                  }-${date1.getDay()}`,
                ),
              },
            },
          ],
        },
        orderBy: {
          start_date: "asc",
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
          event_type: true,
          event_status: true,
          event_attendance: {
            select: {
              created_at: true,
              user: {
                select: {
                  user_info: {
                    select: {
                      user: {
                        select: {
                          name: true,
                          membership_type: true,
                        },
                      },
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
  eventStats = async (req: Request, res: Response) => {
    try {
      const { month, year, event_type, event_status }: any = req.query;
      const data = await prisma.event_mgt.findMany({
        where: {
          AND: [
            { start_date: { gte: new Date(`${year}-01-01`) } }, // Start of the month
            { end_date: { lte: new Date(`${year}-12-31`) } },
          ],
        },
        orderBy: {
          start_date: "asc",
        },
        select: {
          id: true,
          name: true,
          start_date: true,
          end_date: true,
          event_attendance: {
            select: {
              id: true,
              user_id: true,
            },
          },
        },
      });
      function getMonthlyEventStatistics(events: any) {
        const monthlyStats: any = {};

        events.forEach((event: any) => {
          const startDate = new Date(event.start_date);
          const month = startDate.toLocaleString("default", {
            month: "long",
            year: "numeric",
          });

          if (!monthlyStats[month]) {
            monthlyStats[month] = [];
          }
          console.log("zoo");

          const attendanceCount = event.event_attendance.length;

          monthlyStats[month].push({
            event_name: event.name,
            attendanceCount,
          });
        });

        return monthlyStats;
      }

      res.status(200).json({
        message: "Operation successful",
        data: data,
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
          event_type: true,
          event_status: true,
          event_attendance: {
            select: {
              created_at: true,
              user: {
                select: {
                  user_info: {
                    select: {
                      user: {
                        select: {
                          name: true,
                          membership_type: true,
                        },
                      },
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
          country_code,
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
        country_code,
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
      console.log(error);
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

  private async createEventController(data: any): Promise<void> {
    const { start_date, end_date } = data;
    try {
      const event_act_response = await prisma.event_act.create({
        data:{
          name: data.name,
          event_status: data.event_status,
          event_type: data.event_type
        }
      }) 
      const response = await prisma.event_mgt.create({
        data: {
          name: data.name,
          start_date: start_date ? new Date(data.start_date) : null,
          end_date: end_date ? new Date(data.end_date) : null,
          event_act_id: event_act_response?.id,
          start_time: data.start_time,
          end_time: data.end_time,
          location: data.location,
          description: data.description,
          poster: data.poster,
          event_type: data.event_type,
          event_status: data.event_status,
          created_by: data.created_by,
        },
        select: selectQuery,
      });

      const qr_code = await generateQR(
        `${process.env.Frontend_URL}/events/register-event?event_id=${response.id}&event_name=${response.name}`,
      );

      await prisma.event_mgt.update({
        where: {
          id: response.id,
        },
        data: {
          qr_code,
        },
      });
    } catch (error: any) {
      console.log(error);
      return error;
    }
  }

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
    let code1 = code.trim();
    try {
      const data: any = await prisma.user_info.findFirst({
        where: {
          primary_number: phone.startsWith("0") ? phone.substring(1) : phone,
          // country_code: code1.includes("+") ? code1 : `+${code1}`,
        },
        select: {
          first_name: true,
          last_name: true,
          other_name: true,
          primary_number: true,
          user_id: true,
          country_code: true,
          user: {
            select: {
              name: true,
            },
          },
        },
      });
      const { user, ...rest } = data;
      return { ...rest, ...user };
    } catch (error) {
      return null;
    }
  }

  private async listEventsP() {
    try {
      let date = new Date();
      return await prisma.event_mgt.findMany({
        where: {
          AND: [
            {
              start_date: {
                gte: new Date(
                  `${date.getFullYear()}-${date.getMonth() + 1}-01`,
                ),
              },
            }, // Start of the month
          ],
        },
        orderBy: {
          start_date: "asc",
        },
        select: {
          id: true,
          name: true,
          start_date: true,
          end_date: true,
          location: true,
          description: true,
          event_status: true,
          poster: true,
          qr_code: true,
          event_type: true,
          start_time: true,
          end_time: true,
          event_attendance: {
            select: {
              id: true,
              user_id: true,
            },
          },
        },
      });
    } catch (error) {
      return error;
    }
  }
}
