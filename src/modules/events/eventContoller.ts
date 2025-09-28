import { generateQR, generateRecurringDates } from "../../utils";
import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import * as dotenv from "dotenv";
import { addDays } from "date-fns";
import { number } from "joi";

dotenv.config();

const selectQuery = {
  id: true,
  start_time: true,
  description: true,
  end_date: true,
  end_time: true,
  event_status: true,
  event_name_id: true,
  event_type: true,
  location: true,
  poster: true,
  qr_code: true,
  start_date: true,
  event: {
    select: {
      event_name: true,
    },
  },
};

export class eventManagement {
  createEvent = async (req: Request, res: Response) => {
    try {
      let data = req.body;
      if (!data.event_name_id) {
        return res.status(400).json({ message: "Event Name Id not found" });
      }
      let { start_date, end_date, day_event, repetitive, recurring } = req.body;
      const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    if (new Date(start_date) < yesterday) {
      return res
        .status(400)
        .json({ message: "Event start date must be on or after tomorrow" });
    }
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
      const {
        month,
        year,
        event_type,
        event_status,
        page = 1,
        take = 10,
      }: any = req.query;

      const pageNum = parseInt(page, 10) || 1;
      const pageSize = parseInt(take, 10) || 10;
      const skip = (pageNum - 1) * pageSize;

      let whereClause: any = {
        event_type,
        event_status,
      };

      if (month && year) {
        const startOfMonth = new Date(year, month - 1, 1);
        const startOfNextMonth = new Date(year, month, 1);

        whereClause.AND = [
          { start_date: { gte: startOfMonth } },
          { end_date: { lt: startOfNextMonth } },
        ];
      }

      const totalCount = await prisma.event_mgt.count({ where: whereClause });

      const data = await prisma.event_mgt.findMany({
        where: whereClause,
        orderBy: {
          start_date: "asc",
        },
        skip,
        take: pageSize,
        select: {
          id: true,
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
          event: {
            select: {
              event_name: true,
              id: true,
            },
          },
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

      const flat_data = data.map((event) => ({
        ...event,
        event_name_id: event?.event.id,
        event_name: event?.event.event_name,
        event: null,
      }));

      res.status(200).json({
        message: "Operation successful",
        total: totalCount,
        current_page: pageNum,
        page_size: pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        data: flat_data,
      });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({
        message: "Event failed to load",
        data: error.message,
      });
    }
  };
  listEventsLight = async (req: Request, res: Response) => {
    try {
      const { month, year, event_type, event_status }: any = req.query;

      let whereClause: any = {
        event_type,
        event_status,
      };

      if (month && year) {
        const startOfMonth = new Date(year, month - 1, 1);
        const startOfNextMonth = new Date(year, month, 1);

        whereClause.AND = [
          { start_date: { gte: startOfMonth } },
          { end_date: { lt: startOfNextMonth } },
        ];
      }

      const data = await prisma.event_mgt.findMany({
        where: whereClause,
        orderBy: {
          start_date: "asc",
        },
        select: {
          id: true,
          poster: true,
          start_date: true,
          end_date: true,
          start_time: true,
          end_time: true,
          location: true,
          description: true,
          event_type: true,
          event_status: true,
          event: {
            select: {
              event_name: true,
              id: true,
            },
          },
        },
      });

      const flat_data = data.map((e) => {
        const { event, ...rest } = e;
        return {
          ...event,
          event_name_id: event.id,
          event_name: event.event_name,
        };
      });

      res.status(200).json({
        message: "Operation successful",
        data: flat_data,
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
          event: {
            select: {
              event_name: true,
              id: true,
            },
          },
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
      const flat_data = data.map((event) => ({
        ...event,
        event_name_id: event?.event.id,
        event_name: event?.event.event_name,
      }));
      res.status(200).json({
        message: "Operation successful",
        data: flat_data,
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
          event: {
            select: {
              event_name: true,
            },
          },
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
      const flat_data = {
        ...response,
        event_name: response?.event.event_name,
        event: null,
      };
      res
        .status(200)
        .json({ message: "Operation successful", data: flat_data });
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
      const response = await prisma.event_mgt.create({
        data: {
          start_date: start_date ? new Date(data.start_date) : null,
          end_date: end_date ? new Date(data.end_date) : null,
          event_name_id: Number(data.event_name_id),
          start_time: data.start_time,
          end_time: data.end_time,
          location: data.location,
          description: data.description,
          poster: data.poster,
          created_by: data.created_by,
        },
        select: selectQuery,
      });

      const qr_code = await generateQR(
        `${process.env.Frontend_URL}/events/register-event?event_id=${response.id}`,
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
      const raw_events = await prisma.event_mgt.findMany({
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
          event: {
            select: {
              event_name: true,
              id: true,
            },
          },
          event_attendance: {
            select: {
              id: true,
              user_id: true,
            },
          },
        },
      });

      const flattened_events = raw_events.map((event) => ({
        ...event,
        event_name: event.event?.event_name ?? null,
        event_name_id: event.event?.id ?? null,
        event: undefined, // remove nested `event`
      }));

      return flattened_events;
    } catch (error) {
      return error;
    }
  }

  createEventType = async (req: Request, res: Response) => {
    try {
      const { event_name, event_type, event_description } = req.body;

      if (!event_name || !event_type) {
        return res.status(400).json({
          message: "Fields event_name, event_type are required",
        });
      }

      const response = await prisma.event_act.create({
        data: {
          event_name: event_name,
          event_status: "TENTATIVE",
          event_type: event_type,
          event_description: event_description,
        },
      });

      res.status(200).json({
        message: "Event Type Created Succesfully",
        data: response,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to create event type",
        data: error.message,
      });
    }
  };

  updateEventType = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;
      const { event_name, event_type, event_description } = req.body;

      if (!event_name || !event_type || !event_description) {
        return res.status(400).json({
          message:
            "All fields (event_name, event_type, event_description) are required",
        });
      }

      const existing = await prisma.event_act.findUnique({
        where: { id: Number(id) },
      });
      if (!existing) {
        return res.status(404).json({ message: "Event Type not found" });
      }

      const response = await prisma.event_act.update({
        where: { id: Number(id) },
        data: {
          event_name: event_name,
          event_type: event_type,
          event_description: event_description,
        },
      });

      return res.status(200).json({
        message: "Event Type Updated Successfully",
        data: response,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to update event type",
        error: error.message,
      });
    }
  };

  getEventType = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;

      const eventType = await prisma.event_act.findUnique({
        where: { id: Number(id) },
      });

      if (!eventType) {
        return res.status(404).json({ message: "Event Type not found" });
      }

      return res.status(200).json({
        message: "Event Type Fetched",
        data: eventType,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch event type",
        error: error.message,
      });
    }
  };

  getEventTypes = async (req: Request, res: Response) => {
    try {
      const eventTypes = await prisma.event_act.findMany({
        orderBy: { event_name: "asc" },
      });

      return res.status(200).json({
        message: "All Event Types Fetched",
        data: eventTypes,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to fetch event types",
        error: error.message,
      });
    }
  };

  deleteEventType = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;

      const existing = await prisma.event_act.findUnique({
        where: { id: Number(id) },
      });
      if (!existing) {
        return res.status(404).json({ message: "Event Type not found" });
      }

      await prisma.event_act.delete({ where: { id: Number(id) } });

      return res
        .status(200)
        .json({ message: "Event Type Deleted Successfully" });
    } catch (error: any) {
      return res.status(500).json({
        message: "Failed to delete event type",
        error: error.message,
      });
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      const { event_id, user_id } = req.body;

      if (!event_id || !user_id) {
        return res.status(400).json({
          success: false,
          message: "event_id and user_id are required",
        });
      }

      // Check if already registered
      const existing = await prisma.event_registers.findFirst({
        where: {
          event_id: Number(event_id),
          user_id: Number(user_id),
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "User already registered for this event",
        });
      }

      // Create new registration
      const registration = await prisma.event_registers.create({
        data: {
          event_id: Number(event_id),
          user_id: Number(user_id),
        },
        include: {
          user: {
            select: {
              name: true,
              user_info: {
                select: {
                  first_name: true,
                  last_name: true,
                  primary_number: true,
                },
              },
            },
          },
        },
      });

      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        registration,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  };

  allRegisteredMembers = async (req: Request, res: Response) => {
    try {
      const { event_id } = req.query;

      if (!event_id) {
        return res.status(400).json({
          success: false,
          message: "event_id is required",
        });
      }

      const members = await prisma.event_registers.findMany({
        where: {
          event_id: Number(event_id),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              user_info: {
                select: {
                  first_name: true,
                  last_name: true,
                  other_name: true,
                  primary_number: true,
                  country_code: true,
                  country: true,
                },
              },
            },
          },
        },
      });

      const flattenedMembers = members.map((m) => ({
        id: m.id,
        event_id: m.event_id,
        user_id: m.user_id,
        created_at: m.created_at,
        name: m.user.name,
        number: m.user.user_info?.primary_number || null,
        country_code: m.user.user_info?.country_code || null,
        ...m.user.user_info,
      }));

      return res.status(200).json({
        success: true,
        message: "All registered members fetched successfully",
        members: flattenedMembers,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  };

  registeredMember = async (req: Request, res: Response) => {
    try {
      const { event_id, user_id } = req.body;

      if (!event_id || !user_id) {
        return res.status(400).json({
          success: false,
          message: "event_id and user_id are required",
        });
      }

      const member = await prisma.event_registers.findFirst({
        where: {
          event_id: Number(event_id),
          user_id: Number(user_id),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              user_info: {
                select: {
                  first_name: true,
                  last_name: true,
                  other_name: true,
                  primary_number: true,
                  country_code: true,
                  country: true,
                },
              },
            },
          },
        },
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found for this event",
        });
      }

      // flatten
      const flattened = {
        id: member.id,
        event_id: member.event_id,
        user_id: member.user_id,
        created_at: member.created_at,
        name: member.user.name,
        number: member.user.user_info?.primary_number || null,
        country_code: member.user.user_info?.country_code || null,
        ...member.user.user_info,
      };

      return res.status(200).json({
        success: true,
        message: "Registered member fetched successfully",
        member: flattened,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  };
}
