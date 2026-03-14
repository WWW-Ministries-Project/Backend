import { generateQR, generateRecurringDates } from "../../utils";
import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import * as dotenv from "dotenv";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfDay,
  startOfMonth,
} from "date-fns";
import { notificationService } from "../notifications/notificationService";
import {
  EventBiometricAttendanceImportError,
  EventBiometricAttendanceService,
} from "./biometricAttendanceService";

dotenv.config();

const biometricAttendanceService = new EventBiometricAttendanceService();

const eventAttendanceSelect = {
  created_at: true,
  user: {
    select: {
      user_info: {
        select: {
          user: {
            select: {
              name: true,
              membership_type: true,
              member_id: true,
              email: true,
            },
          },
          first_name: true,
          last_name: true,
          other_name: true,
          primary_number: true,
          email: true,
          address: true,
          city: true,
          country: true,
          country_code: true,
        },
      },
    },
  },
};

const eventRegistrationSelect = {
  id: true,
  event_id: true,
  user_id: true,
  attendee_name: true,
  attendee_email: true,
  attendee_phone: true,
  attendee_location: true,
  is_member: true,
  member_id: true,
  created_at: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      member_id: true,
      user_info: {
        select: {
          first_name: true,
          last_name: true,
          other_name: true,
          primary_number: true,
          country_code: true,
          country: true,
          city: true,
          address: true,
          email: true,
        },
      },
    },
  },
};

const eventBaseSelect = {
  id: true,
  poster: true,
  start_date: true,
  end_date: true,
  recurrence_end_date: true,
  start_time: true,
  end_time: true,
  qr_code: true,
  location: true,
  description: true,
  created_by: true,
  public_registration_token: true,
  event_type: true,
  event_status: true,
  requires_registration: true,
  registration_end_date: true,
  registration_capacity: true,
  registration_audience: true,
  event_name_id: true,
  event: {
    select: {
      event_name: true,
      id: true,
    },
  },
  event_attendance: {
    select: eventAttendanceSelect,
  },
  _count: {
    select: {
      event_registers: true,
    },
  },
};

const eventListSelect = eventBaseSelect;

const eventDetailSelect = {
  ...eventBaseSelect,
  event_registers: {
    select: eventRegistrationSelect,
  },
};

const eventMutationSelect = {
  id: true,
  start_time: true,
  description: true,
  end_date: true,
  recurrence_end_date: true,
  end_time: true,
  event_status: true,
  event_name_id: true,
  event_type: true,
  location: true,
  poster: true,
  qr_code: true,
  public_registration_token: true,
  requires_registration: true,
  registration_end_date: true,
  registration_capacity: true,
  registration_audience: true,
  start_date: true,
  event: {
    select: {
      event_name: true,
    },
  },
};

const publicEventSelect = {
  id: true,
  start_date: true,
  end_date: true,
  recurrence_end_date: true,
  start_time: true,
  end_time: true,
  location: true,
  description: true,
  poster: true,
  qr_code: true,
  public_registration_token: true,
  requires_registration: true,
  registration_end_date: true,
  registration_capacity: true,
  registration_audience: true,
  event_type: true,
  event_status: true,
  event: {
    select: {
      event_name: true,
      id: true,
    },
  },
  _count: {
    select: {
      event_registers: true,
    },
  },
};

export class eventManagement {
  private getStartOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private toPositiveInt(value: unknown) {
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      return null;
    }

    return parsedValue;
  }

  private getActorUserId(req: Request) {
    return this.toPositiveInt((req as any)?.user?.id);
  }

  private getWeekDayNumber(dateValue: Date | string | null | undefined) {
    if (!dateValue) {
      return null;
    }

    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    const weekDay = parsedDate.getUTCDay();
    return weekDay === 0 ? 7 : weekDay;
  }

  private getMonthDateRange(month: any, year: any) {
    const hasMonth = month !== undefined && month !== null && month !== "";
    const hasYear = year !== undefined && year !== null && year !== "";

    if (!hasMonth || !hasYear) {
      return null;
    }

    const parsedMonth = Number(month);
    const parsedYear = Number(year);

    if (
      !Number.isInteger(parsedMonth) ||
      parsedMonth < 1 ||
      parsedMonth > 12 ||
      !Number.isInteger(parsedYear) ||
      parsedYear <= 0
    ) {
      return null;
    }

    const startOfMonth = new Date(parsedYear, parsedMonth - 1, 1);
    const startOfNextMonth = new Date(parsedYear, parsedMonth, 1);

    return {
      gte: startOfMonth,
      lt: startOfNextMonth,
    };
  }

  private getRollingWindowDateRange(page: number = 1) {
    const safePage = Math.max(page, 1);
    const startOfToday = this.getStartOfToday();
    const firstPageEndExclusive = startOfMonth(addMonths(startOfToday, 4));

    if (safePage === 1) {
      return {
        gte: startOfToday,
        lt: firstPageEndExclusive,
      };
    }

    const rangeStart = addMonths(firstPageEndExclusive, (safePage - 2) * 3);
    const rangeEnd = addMonths(rangeStart, 3);

    return {
      gte: rangeStart,
      lt: rangeEnd,
    };
  }

  private resolveStartDateRange(month: any, year: any, page: number = 1) {
    const monthRange = this.getMonthDateRange(month, year);
    if (monthRange) {
      return monthRange;
    }

    return this.getRollingWindowDateRange(page);
  }

  private normalizeOptionalString(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    const normalizedValue = String(value).trim();
    return normalizedValue ? normalizedValue : null;
  }

  private normalizeOptionalEmail(value: unknown) {
    const normalizedValue = this.normalizeOptionalString(value);
    return normalizedValue ? normalizedValue.toLowerCase() : null;
  }

  private normalizePhoneNumberForLookup(value: unknown) {
    const normalizedValue = this.normalizeOptionalString(value);
    if (!normalizedValue) {
      return null;
    }

    const digitsOnly = normalizedValue.replace(/\D/g, "");
    if (!digitsOnly) {
      return null;
    }

    if (digitsOnly.startsWith("233") && digitsOnly.length > 3) {
      return digitsOnly.slice(3);
    }

    if (digitsOnly.startsWith("0") && digitsOnly.length > 1) {
      return digitsOnly.slice(1);
    }

    return digitsOnly;
  }

  private toBoolean(value: unknown) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalizedValue = String(value ?? "")
      .trim()
      .toLowerCase();

    return ["true", "1", "yes", "on"].includes(normalizedValue);
  }

  private parseOptionalDate(value: unknown) {
    const normalizedValue = this.normalizeOptionalString(value);
    if (!normalizedValue) {
      return null;
    }

    const parsedValue = new Date(normalizedValue);
    if (Number.isNaN(parsedValue.getTime())) {
      return null;
    }

    return parsedValue;
  }

  private normalizeRegistrationAudience(value: unknown) {
    const normalizedValue = String(value ?? "")
      .trim()
      .toUpperCase();

    if (normalizedValue === "MEMBERS_ONLY") {
      return "MEMBERS_ONLY";
    }

    return "MEMBERS_AND_NON_MEMBERS";
  }

  private buildPublicRegistrationUrl(
    token: string | null | undefined,
    eventId: number | null | undefined,
  ) {
    if (!token && !eventId) {
      return null;
    }

    const baseUrl =
      this.normalizeOptionalString(process.env.Frontend_URL) ??
      "http://localhost:5173";
    const url = new URL("/out/events/register-event", baseUrl);

    if (token) {
      url.searchParams.set("token", token);
    } else if (eventId) {
      url.searchParams.set("event_id", String(eventId));
    }

    return url.toString();
  }

  private buildUserLocation(userInfo: any) {
    if (!userInfo) {
      return null;
    }

    const locationParts = [
      this.normalizeOptionalString(userInfo.address),
      this.normalizeOptionalString(userInfo.city),
      this.normalizeOptionalString(userInfo.country),
    ].filter((part): part is string => Boolean(part));

    if (!locationParts.length) {
      return null;
    }

    return locationParts.join(", ");
  }

  private mapEventRegistrationRow(registration: any) {
    const userInfo = registration?.user?.user_info;
    const fallbackName = [
      this.normalizeOptionalString(userInfo?.first_name),
      this.normalizeOptionalString(userInfo?.other_name),
      this.normalizeOptionalString(userInfo?.last_name),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ");

    return {
      id: registration.id,
      event_id: registration.event_id,
      user_id: registration.user_id ?? null,
      created_at: registration.created_at,
      is_member: Boolean(registration.is_member),
      member_id:
        registration.member_id ??
        registration.user?.member_id ??
        null,
      name:
        registration.attendee_name ??
        registration.user?.name ??
        fallbackName ??
        null,
      email:
        registration.attendee_email ??
        registration.user?.email ??
        userInfo?.email ??
        null,
      phone:
        registration.attendee_phone ??
        userInfo?.primary_number ??
        null,
      location:
        registration.attendee_location ??
        this.buildUserLocation(userInfo),
      country_code: userInfo?.country_code ?? null,
    };
  }

  private mapEventResponse(event: any) {
    if (!event) {
      return null;
    }

    const flattenedEvent = {
      ...event,
      event_name_id: event?.event?.id ?? event?.event_name_id ?? null,
      event_name: event?.event?.event_name ?? null,
      name: event?.event?.event_name ?? null,
      day_of_week: this.getWeekDayNumber(event?.start_date),
      public_registration_url: event?.requires_registration
        ? this.buildPublicRegistrationUrl(
            event?.public_registration_token,
            event?.id,
          )
        : null,
      registration_count:
        event?._count?.event_registers ??
        (Array.isArray(event?.event_registers)
          ? event.event_registers.length
          : 0),
      event_registers: Array.isArray(event?.event_registers)
        ? event.event_registers.map((registration: any) =>
            this.mapEventRegistrationRow(registration),
          )
        : undefined,
      event: null,
    };

    if ("_count" in flattenedEvent) {
      delete (flattenedEvent as any)._count;
    }

    return flattenedEvent;
  }

  private resolvePublicEventLookup(source: Record<string, unknown>) {
    const token = this.normalizeOptionalString(source?.token);
    if (token) {
      return {
        where: {
          public_registration_token: token,
        } as const,
      };
    }

    const eventId = this.toPositiveInt(source?.event_id ?? source?.id);
    if (!eventId) {
      return null;
    }

    return {
      where: {
        id: eventId,
      } as const,
    };
  }

  private async findPublicEvent(source: Record<string, unknown>) {
    const lookup = this.resolvePublicEventLookup(source);
    if (!lookup) {
      return null;
    }

    return prisma.event_mgt.findUnique({
      where: lookup.where,
      select: publicEventSelect,
    });
  }

  private assertRegistrationAvailability(event: any) {
    if (!event?.requires_registration) {
      return "Registration is not enabled for this event.";
    }

    if (event?.registration_end_date) {
      const registrationDeadline = endOfDay(new Date(event.registration_end_date));
      if (registrationDeadline < new Date()) {
        return "Registration for this event has closed.";
      }
    }

    const registrationCapacity = this.toPositiveInt(event?.registration_capacity);
    const registrationCount = Number(event?._count?.event_registers ?? 0);
    if (
      registrationCapacity &&
      registrationCount >= registrationCapacity
    ) {
      return "This event has reached full capacity.";
    }

    return null;
  }

  private async findMemberByRegistrationCredentials(params: {
    memberId?: unknown;
    phoneNumber?: unknown;
  }) {
    const normalizedMemberId = this.normalizeOptionalString(params?.memberId);
    const normalizedPhoneNumber = this.normalizePhoneNumberForLookup(
      params?.phoneNumber,
    );

    if (!normalizedMemberId && !normalizedPhoneNumber) {
      return null;
    }

    return prisma.user.findFirst({
      where: {
        OR: [
          ...(normalizedMemberId
            ? [
                {
                  member_id: normalizedMemberId,
                },
              ]
            : []),
          ...(normalizedPhoneNumber
            ? [
                {
                  user_info: {
                    is: {
                      primary_number: normalizedPhoneNumber,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        member_id: true,
        membership_type: true,
        user_info: {
          select: {
            first_name: true,
            last_name: true,
            other_name: true,
            primary_number: true,
            email: true,
            address: true,
            city: true,
            country: true,
            country_code: true,
          },
        },
      },
    });
  }

  private buildValidatedMemberPayload(member: any) {
    if (!member) {
      return null;
    }

    return {
      user_id: member.id,
      member_id: member.member_id,
      name: member.name,
      email: member.email ?? member.user_info?.email ?? null,
      phone_number: member.user_info?.primary_number ?? null,
      location: this.buildUserLocation(member.user_info),
      country_code: member.user_info?.country_code ?? null,
      membership_type: member.membership_type ?? null,
    };
  }

  private buildEventSchedulePayload(data: any): any {
    const startDate = this.parseOptionalDate(data?.start_date);
    if (!startDate) {
      return {
        error: "A valid start_date is required",
      };
    }

    const isRecurring = String(data?.repetitive ?? "no").toLowerCase() === "yes";
    const isMultiDay = String(data?.day_event ?? "one").toLowerCase() === "multi";
    const providedEndDate = this.parseOptionalDate(data?.end_date);
    const eventEndDate = isMultiDay
      ? providedEndDate ?? addDays(startDate, 1)
      : startDate;

    if (eventEndDate < startDate) {
      return {
        error: "Event end date cannot be before start date",
      };
    }

    const recurrenceEndDate = isRecurring
      ? this.parseOptionalDate(data?.recurrence_end_date)
      : null;

    if (isRecurring && !recurrenceEndDate) {
      return {
        error: "A valid recurrence_end_date is required for recurring events",
      };
    }

    if (recurrenceEndDate && recurrenceEndDate < startDate) {
      return {
        error: "Recurrence end date cannot be before start date",
      };
    }

    const durationInDays = Math.max(
      0,
      differenceInCalendarDays(eventEndDate, startDate),
    );

    const recurring = {
      ...(data?.recurring ?? {}),
    };

    if (isMultiDay) {
      delete recurring.daysOfWeek;
    }

    const occurrenceDates = isRecurring
      ? generateRecurringDates(startDate, recurrenceEndDate as Date, recurring)
      : [startDate];

    if (!occurrenceDates.length) {
      return {
        error: "No event dates generated for the provided payload",
      };
    }

    return {
      startDate,
      eventEndDate,
      recurrenceEndDate,
      isRecurring,
      durationInDays,
      occurrenceDates,
    };
  }

  private buildRegistrationSettingsPayload(data: any, startDate: Date): any {
    const requiresRegistration = this.toBoolean(data?.requires_registration);
    if (!requiresRegistration) {
      return {
        requires_registration: false,
        registration_end_date: null,
        registration_capacity: null,
        registration_audience: "MEMBERS_AND_NON_MEMBERS" as const,
      };
    }

    const registrationEndDate = this.parseOptionalDate(data?.registration_end_date);
    if (!registrationEndDate) {
      return {
        error: "A valid registration_end_date is required when registration is enabled",
      };
    }

    const registrationCapacity = this.toPositiveInt(data?.registration_capacity);
    if (!registrationCapacity) {
      return {
        error: "A valid registration_capacity is required when registration is enabled",
      };
    }

    if (registrationEndDate > endOfDay(startDate)) {
      return {
        error: "Registration end date cannot be after the event start date",
      };
    }

    return {
      requires_registration: true,
      registration_end_date: registrationEndDate,
      registration_capacity: registrationCapacity,
      registration_audience: this.normalizeRegistrationAudience(
        data?.registration_audience,
      ),
    };
  }

  createEvent = async (req: Request, res: Response) => {
    try {
      const data = req.body;
      const createdEventIds: number[] = [];
      const actorUserId = this.getActorUserId(req);

      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      if (!data.event_name_id) {
        return res.status(400).json({ message: "Event Name Id not found" });
      }
      const schedulePayload = this.buildEventSchedulePayload(data);
      if (schedulePayload.error) {
        return res.status(400).json({
          message: schedulePayload.error,
          data: null,
        });
      }

      const registrationPayload = this.buildRegistrationSettingsPayload(
        data,
        schedulePayload.startDate,
      );
      if (registrationPayload.error) {
        return res.status(400).json({
          message: registrationPayload.error,
          data: null,
        });
      }

      for (const occurrenceStartDate of schedulePayload.occurrenceDates) {
        const eventId = await this.createEventController({
          ...data,
          ...registrationPayload,
          created_by: actorUserId,
          start_date: occurrenceStartDate,
          end_date: addDays(
            occurrenceStartDate,
            schedulePayload.durationInDays,
          ),
          recurrence_end_date: schedulePayload.recurrenceEndDate,
        });
        createdEventIds.push(eventId);
      }

      const responseData = await this.listEventsP();
      if (registrationPayload.requires_registration) {
        this.queueQrGeneration(createdEventIds);
      }

      return res.status(200).json({
        message: "Event Created Succesfully",
        data: responseData,
        meta: {
          created_count: createdEventIds.length,
          qr_status: registrationPayload.requires_registration
            ? "processing"
            : "skipped",
        },
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
        recurrence_end_date,
        requires_registration,
        registration_end_date,
        registration_capacity,
        registration_audience,
      } = req.body;
      const actorUserId = this.getActorUserId(req);

      if (!actorUserId) {
        return res.status(401).json({
          message: "A valid authenticated user is required",
          data: null,
        });
      }

      const rawId = req.body?.id ?? req.query?.id;
      const eventId = Number(Array.isArray(rawId) ? rawId[0] : rawId);

      if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
          message: "A valid event id is required",
          data: null,
        });
      }

      const parsedStartDate = start_date ? new Date(start_date) : null;
      if (start_date && Number.isNaN(parsedStartDate?.getTime())) {
        return res.status(400).json({
          message: "Invalid start_date",
          data: null,
        });
      }

      const parsedEndDate = end_date ? new Date(end_date) : null;
      if (end_date && Number.isNaN(parsedEndDate?.getTime())) {
        return res.status(400).json({
          message: "Invalid end_date",
          data: null,
        });
      }

      const hasRecurrenceEndDateInput = Object.prototype.hasOwnProperty.call(
        req.body,
        "recurrence_end_date",
      );
      const parsedRecurrenceEndDate = hasRecurrenceEndDateInput
        ? this.parseOptionalDate(recurrence_end_date)
        : undefined;
      if (
        hasRecurrenceEndDateInput &&
        this.normalizeOptionalString(recurrence_end_date) &&
        !parsedRecurrenceEndDate
      ) {
        return res.status(400).json({
          message: "Invalid recurrence_end_date",
          data: null,
        });
      }

      const existance = await prisma.event_mgt.findUnique({
        where: {
          id: eventId,
        },
        select: eventMutationSelect,
      });

      if (!existance) {
        return res.status(400).json({ message: "No Event found", data: null });
      }

      const resolvedStartDate = parsedStartDate ?? existance.start_date;
      const resolvedEndDate = parsedEndDate ?? existance.end_date;
      const resolvedRecurrenceEndDate = hasRecurrenceEndDateInput
        ? parsedRecurrenceEndDate ?? null
        : existance.recurrence_end_date;

      if (
        resolvedStartDate &&
        resolvedEndDate &&
        resolvedEndDate < resolvedStartDate
      ) {
        return res.status(400).json({
          message: "Event end date cannot be before start date",
          data: null,
        });
      }

      if (
        resolvedRecurrenceEndDate &&
        resolvedStartDate &&
        resolvedRecurrenceEndDate < resolvedStartDate
      ) {
        return res.status(400).json({
          message: "Recurrence end date cannot be before start date",
          data: null,
        });
      }

      const hasRegistrationInput = [
        "requires_registration",
        "registration_end_date",
        "registration_capacity",
        "registration_audience",
      ].some((field) => Object.prototype.hasOwnProperty.call(req.body, field));

      const registrationPayload = hasRegistrationInput
        ? this.buildRegistrationSettingsPayload(
            {
              requires_registration:
                requires_registration ?? existance.requires_registration,
              registration_end_date:
                registration_end_date ?? existance.registration_end_date,
              registration_capacity:
                registration_capacity ?? existance.registration_capacity,
              registration_audience:
                registration_audience ?? existance.registration_audience,
            },
            resolvedStartDate ?? new Date(),
          )
        : null;

      if (registrationPayload?.error) {
        return res.status(400).json({
          message: registrationPayload.error,
          data: null,
        });
      }

      const response = await prisma.event_mgt.update({
        where: {
          id: eventId,
        },
        data: {
          start_date: resolvedStartDate,
          end_date: resolvedEndDate,
          recurrence_end_date: resolvedRecurrenceEndDate,
          start_time: start_time ? start_time : existance.start_time,
          end_time: end_time ? end_time : existance.end_time,
          location: location ? location : existance.location,
          description: description ? description : existance.description,
          poster: poster ? poster : existance.poster,
          updated_by: actorUserId,
          event_type: event_type ? event_type : existance.event_type,
          event_status: event_status ? event_status : existance.event_status,
          requires_registration:
            registrationPayload?.requires_registration ??
            existance.requires_registration,
          registration_end_date:
            registrationPayload?.registration_end_date ??
            existance.registration_end_date,
          registration_capacity:
            registrationPayload?.registration_capacity ??
            existance.registration_capacity,
          registration_audience:
            registrationPayload?.registration_audience ??
            existance.registration_audience,
          qr_code:
            registrationPayload?.requires_registration === false
              ? null
              : qr_code
                ? qr_code
                : existance.qr_code,
          updated_at: new Date(),
        },
        select: eventMutationSelect,
      });

      if (
        (registrationPayload?.requires_registration ?? existance.requires_registration) &&
        !response.qr_code
      ) {
        this.queueQrGeneration([eventId]);
      }

      const registeredUsers = await prisma.event_registers.findMany({
        where: {
          event_id: eventId,
        },
        select: {
          user_id: true,
        },
      });

      const recipientUserIds = Array.from(
        new Set(
          registeredUsers
            .map((registration) => Number(registration.user_id))
            .filter(
              (id): id is number =>
                Number.isInteger(id) &&
                id > 0 &&
                (!Number.isInteger(actorUserId) || id !== actorUserId),
            ),
        ),
      );

      if (recipientUserIds.length) {
        await notificationService.createManyInAppNotifications(
          recipientUserIds.map((recipientUserId) => ({
            type: "event.updated",
            title: "Event updated",
            body: "An event you registered for has been updated.",
            recipientUserId,
            actorUserId:
              Number.isInteger(actorUserId) && actorUserId > 0
                ? actorUserId
                : null,
            entityType: "EVENT",
            entityId: String(eventId),
            actionUrl: "/home/events",
            priority: "MEDIUM",
            dedupeKey: `event:${eventId}:updated:${Date.now()}:recipient:${recipientUserId}`,
          })),
        );
      }

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
      const eventId = Number(id);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
          message: "A valid event id is required",
          data: null,
        });
      }

      const actorUserId = Number((req as any)?.user?.id);
      const registeredUsers = await prisma.event_registers.findMany({
        where: {
          event_id: eventId,
        },
        select: {
          user_id: true,
        },
      });

      const response = await prisma.event_mgt.delete({
        where: {
          id: eventId,
        },
      });

      const recipientUserIds = Array.from(
        new Set(
          registeredUsers
            .map((registration) => Number(registration.user_id))
            .filter(
              (userId): userId is number =>
                Number.isInteger(userId) &&
                userId > 0 &&
                (!Number.isInteger(actorUserId) || userId !== actorUserId),
            ),
        ),
      );

      if (recipientUserIds.length) {
        await notificationService.createManyInAppNotifications(
          recipientUserIds.map((recipientUserId) => ({
            type: "event.cancelled",
            title: "Event cancelled",
            body: "An event you registered for has been cancelled.",
            recipientUserId,
            actorUserId:
              Number.isInteger(actorUserId) && actorUserId > 0
                ? actorUserId
                : null,
            entityType: "EVENT",
            entityId: String(eventId),
            actionUrl: "/home/events",
            priority: "HIGH",
            dedupeKey: `event:${eventId}:cancelled:recipient:${recipientUserId}`,
          })),
        );
      }

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
        take,
      }: any = req.query;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const pageSize = Math.max(parseInt(take, 10) || 10, 1);
      const skip = (pageNum - 1) * pageSize;
      const hasTakeParam =
        take !== undefined && take !== null && `${take}`.trim() !== "";
      const monthRange = this.getMonthDateRange(month, year);
      const useRollingWindow = !monthRange && !hasTakeParam;

      let whereClause: any = {
        event_type,
        event_status,
      };

      if (monthRange) {
        whereClause.start_date = monthRange;
      } else if (useRollingWindow) {
        whereClause.start_date = this.resolveStartDateRange(month, year, pageNum);
      }

      let totalCount = 0;
      let totalPages = 0;
      let responsePageSize = pageSize;
      let data: any[] = [];

      if (monthRange) {
        totalCount = await prisma.event_mgt.count({ where: whereClause });

        data = await prisma.event_mgt.findMany({
          where: whereClause,
          orderBy: {
            start_date: "asc",
          },
          skip,
          take: pageSize,
          select: eventListSelect,
        });

        totalPages = Math.ceil(totalCount / pageSize);
      } else if (useRollingWindow) {
        responsePageSize = 3;

        totalCount = await prisma.event_mgt.count({ where: whereClause });

        data = await prisma.event_mgt.findMany({
          where: whereClause,
          orderBy: {
            start_date: "asc",
          },
          select: eventListSelect,
        });

        const startOfToday = this.getStartOfToday();
        const latestEvent = await prisma.event_mgt.findFirst({
          where: {
            event_type,
            event_status,
            start_date: {
              gte: startOfToday,
            },
          },
          orderBy: {
            start_date: "desc",
          },
          select: {
            start_date: true,
          },
        });

        if (latestEvent?.start_date) {
          const latestStartDate = new Date(latestEvent.start_date);
          const firstPageEndExclusive = startOfMonth(addMonths(startOfToday, 4));

          if (latestStartDate < firstPageEndExclusive) {
            totalPages = 1;
          } else {
            const latestMonthStart = startOfMonth(latestStartDate);
            const diffInMonths =
              (latestMonthStart.getFullYear() -
                firstPageEndExclusive.getFullYear()) *
                12 +
              (latestMonthStart.getMonth() - firstPageEndExclusive.getMonth());

            totalPages = 2 + Math.floor(diffInMonths / 3);
          }
        } else {
          totalPages = 0;
        }
      } else {
        totalCount = await prisma.event_mgt.count({ where: whereClause });

        data = await prisma.event_mgt.findMany({
          where: whereClause,
          orderBy: {
            start_date: "asc",
          },
          skip,
          take: pageSize,
          select: eventListSelect,
        });

        totalPages = Math.ceil(totalCount / pageSize);
      }

      const flat_data = data.map((event) => this.mapEventResponse(event));

      res.status(200).json({
        message: "Operation successful",
        total: totalCount,
        current_page: pageNum,
        page_size: responsePageSize,
        totalPages,
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

      const startDateRange = this.resolveStartDateRange(month, year);

      let whereClause: any = {
        event_type,
        event_status,
        start_date: startDateRange,
      };

      const data = await prisma.event_mgt.findMany({
        where: whereClause,
        orderBy: {
          start_date: "asc",
        },
        select: eventListSelect,
      });

      const flat_data = data.map((event) => this.mapEventResponse(event));

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
                  }-${date1.getDate()}`,
                ),
              },
            },
          ],
        },
        orderBy: {
          start_date: "asc",
        },
        select: eventListSelect,
      });
      const flat_data = data.map((event) => this.mapEventResponse(event));
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
        select: eventDetailSelect,
      });
      const flat_data = this.mapEventResponse(response);
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

  private async createEventController(data: any): Promise<number> {
    const { start_date, end_date } = data;
    try {
      const response = await prisma.event_mgt.create({
        data: {
          start_date: start_date ? new Date(data.start_date) : null,
          end_date: end_date ? new Date(data.end_date) : null,
          recurrence_end_date: data.recurrence_end_date
            ? new Date(data.recurrence_end_date)
            : null,
          event_name_id: Number(data.event_name_id),
          start_time: data.start_time,
          end_time: data.end_time,
          location: data.location,
          description: data.description,
          poster: data.poster,
          event_type: data.event_type || null,
          created_by: data.created_by,
          requires_registration: Boolean(data.requires_registration),
          registration_end_date: data.registration_end_date
            ? new Date(data.registration_end_date)
            : null,
          registration_capacity: this.toPositiveInt(data.registration_capacity),
          registration_audience: this.normalizeRegistrationAudience(
            data.registration_audience,
          ),
        },
        select: eventMutationSelect,
      });
      return response.id;
    } catch (error: any) {
      console.log(error);
      throw error;
    }
  }

  private queueQrGeneration(eventIds: number[]) {
    if (!eventIds.length) {
      return;
    }

    setImmediate(() => {
      this.processQrGeneration(eventIds).catch((error) => {
        console.log("Background QR generation failed", error);
      });
    });
  }

  private async processQrGeneration(eventIds: number[]) {
    const batchSize = Math.max(
      1,
      Math.min(Number(process.env.EVENT_QR_BATCH_SIZE ?? 2), 2),
    );

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);
      await Promise.all(batch.map((eventId) => this.updateEventQrCode(eventId)));
    }
  }

  private async updateEventQrCode(eventId: number) {
    try {
      const event = await prisma.event_mgt.findUnique({
        where: {
          id: eventId,
        },
        select: {
          id: true,
          public_registration_token: true,
          requires_registration: true,
        },
      });

      if (!event?.requires_registration) {
        return;
      }

      const publicRegistrationUrl = this.buildPublicRegistrationUrl(
        event.public_registration_token,
        event.id,
      );
      if (!publicRegistrationUrl) {
        return;
      }

      const qr_code = await generateQR(
        publicRegistrationUrl,
      );

      if (!qr_code || qr_code === "Unable to upload") {
        return;
      }

      await prisma.event_mgt.update({
        where: {
          id: eventId,
        },
        data: {
          qr_code,
        },
      });
    } catch (error) {
      console.log(`QR update failed for event ${eventId}`, error);
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
        select: eventListSelect,
      });

      const flattened_events = raw_events.map((event) =>
        this.mapEventResponse(event),
      );

      return flattened_events;
    } catch (error) {
      throw error;
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

  publicEventDetails = async (req: Request, res: Response) => {
    try {
      const event = await this.findPublicEvent(req.query as Record<string, unknown>);

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      const availabilityMessage = this.assertRegistrationAvailability(event);

      return res.status(200).json({
        success: true,
        message: "Operation successful",
        data: {
          ...this.mapEventResponse(event),
          registration_open: !availabilityMessage,
          registration_message: availabilityMessage,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch event details",
        data: error?.message,
      });
    }
  };

  validatePublicMemberRegistration = async (req: Request, res: Response) => {
    try {
      const event = await this.findPublicEvent(req.body as Record<string, unknown>);

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      const availabilityMessage = this.assertRegistrationAvailability(event);
      if (availabilityMessage) {
        return res.status(400).json({
          success: false,
          message: availabilityMessage,
        });
      }

      const member = await this.findMemberByRegistrationCredentials({
        memberId: req.body?.member_id,
        phoneNumber: req.body?.phone_number,
      });

      if (!req.body?.member_id && !req.body?.phone_number) {
        return res.status(400).json({
          success: false,
          message: "Provide either member_id or phone_number to validate",
        });
      }

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member details could not be validated",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Member validated successfully",
        data: this.buildValidatedMemberPayload(member),
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Unable to validate member details",
        data: error?.message,
      });
    }
  };

  private async createEventRegistration(params: {
    event: any;
    isMember: boolean;
    userId?: number | null;
    memberId?: string | null;
    attendeeName?: string | null;
    attendeeEmail?: string | null;
    attendeePhone?: string | null;
    attendeeLocation?: string | null;
  }) {
    const attendeeName = this.normalizeOptionalString(params.attendeeName);
    const attendeeEmail = this.normalizeOptionalEmail(params.attendeeEmail);
    const attendeePhone = this.normalizeOptionalString(params.attendeePhone);
    const attendeeLocation = this.normalizeOptionalString(params.attendeeLocation);

    const duplicateRegistration = params.userId
      ? await prisma.event_registers.findFirst({
          where: {
            event_id: params.event.id,
            user_id: params.userId,
          },
        })
      : await prisma.event_registers.findFirst({
          where: {
            event_id: params.event.id,
            attendee_email: attendeeEmail,
          },
        });

    if (duplicateRegistration) {
      return {
        error: params.isMember
          ? "User already registered for this event"
          : "This email is already registered for the event",
      };
    }

    const registration = await prisma.event_registers.create({
      data: {
        event_id: params.event.id,
        user_id: params.userId ?? null,
        attendee_name: attendeeName,
        attendee_email: attendeeEmail,
        attendee_phone: attendeePhone,
        attendee_location: attendeeLocation,
        is_member: params.isMember,
        member_id: params.memberId ?? null,
      },
      select: eventRegistrationSelect,
    });

    if (params.userId) {
      await notificationService.createInAppNotification({
        type: "event.registration_success",
        title: "Event registration successful",
        body: "You have successfully registered for this event.",
        recipientUserId: params.userId,
        actorUserId: null,
        entityType: "EVENT",
        entityId: String(params.event.id),
        actionUrl: "/home/events",
        priority: "LOW",
        dedupeKey: `event:${params.event.id}:registration-success:${params.userId}`,
      });
    }

    return {
      registration: this.mapEventRegistrationRow(registration),
    };
  }

  publicRegister = async (req: Request, res: Response) => {
    try {
      const event = await this.findPublicEvent(req.body as Record<string, unknown>);

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      const availabilityMessage = this.assertRegistrationAvailability(event);
      if (availabilityMessage) {
        return res.status(400).json({
          success: false,
          message: availabilityMessage,
        });
      }

      const isMember = this.toBoolean(req.body?.is_member);

      if (
        !isMember &&
        event.registration_audience === "MEMBERS_ONLY"
      ) {
        return res.status(403).json({
          success: false,
          message: "This event is open to members only.",
        });
      }

      if (isMember) {
        if (!req.body?.member_id && !req.body?.phone_number) {
          return res.status(400).json({
            success: false,
            message: "Provide either member_id or phone_number to register as a member",
          });
        }

        const member = await this.findMemberByRegistrationCredentials({
          memberId: req.body?.member_id,
          phoneNumber: req.body?.phone_number,
        });

        if (!member) {
          return res.status(404).json({
            success: false,
            message: "Member details could not be validated",
          });
        }

        const registrationResult = await this.createEventRegistration({
          event,
          isMember: true,
          userId: member.id,
          memberId: member.member_id,
          attendeeName: member.name,
          attendeeEmail: member.email ?? member.user_info?.email ?? null,
          attendeePhone: member.user_info?.primary_number ?? null,
          attendeeLocation: this.buildUserLocation(member.user_info),
        });

        if (registrationResult.error) {
          return res.status(400).json({
            success: false,
            message: registrationResult.error,
          });
        }

        return res.status(201).json({
          success: true,
          message: "Registration completed successfully",
          data: {
            message: "Registration completed successfully",
            registration: registrationResult.registration,
          },
        });
      }

      const attendeeName = this.normalizeOptionalString(req.body?.name);
      const attendeeEmail = this.normalizeOptionalEmail(req.body?.email);
      const attendeePhone = this.normalizeOptionalString(req.body?.phone_number);
      const attendeeLocation = this.normalizeOptionalString(req.body?.location);

      if (!attendeeName || !attendeeEmail || !attendeePhone || !attendeeLocation) {
        return res.status(400).json({
          success: false,
          message:
            "name, email, phone_number, and location are required for non-member registration",
        });
      }

      const registrationResult = await this.createEventRegistration({
        event,
        isMember: false,
        attendeeName,
        attendeeEmail,
        attendeePhone,
        attendeeLocation,
      });

      if (registrationResult.error) {
        return res.status(400).json({
          success: false,
          message: registrationResult.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Registration completed successfully",
        data: {
          message: "Registration completed successfully",
          registration: registrationResult.registration,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Unable to complete registration",
        data: error?.message,
      });
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      const { event_id, user_id } = req.body;
      const authenticatedUserId = Number((req as any).user?.id);
      const targetUserId =
        Number.isInteger(authenticatedUserId) && authenticatedUserId > 0
          ? authenticatedUserId
          : Number(user_id);

      if (
        !event_id ||
        !Number.isInteger(targetUserId) ||
        targetUserId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "event_id and valid user context are required",
        });
      }

      const event = await prisma.event_mgt.findUnique({
        where: {
          id: Number(event_id),
        },
        select: publicEventSelect,
      });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      const availabilityMessage = this.assertRegistrationAvailability(event);
      if (availabilityMessage) {
        return res.status(400).json({
          success: false,
          message: availabilityMessage,
        });
      }

      const member = await prisma.user.findUnique({
        where: {
          id: targetUserId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          member_id: true,
          user_info: {
            select: {
              primary_number: true,
              email: true,
              address: true,
              city: true,
              country: true,
            },
          },
        },
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const registrationResult = await this.createEventRegistration({
        event,
        isMember: true,
        userId: member.id,
        memberId: member.member_id,
        attendeeName: member.name,
        attendeeEmail: member.email ?? member.user_info?.email ?? null,
        attendeePhone: member.user_info?.primary_number ?? null,
        attendeeLocation: this.buildUserLocation(member.user_info),
      });

      if (registrationResult.error) {
        return res.status(400).json({
          success: false,
          message: registrationResult.error,
        });
      }

      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          message: "User registered successfully",
          registration: registrationResult.registration,
        },
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
        select: eventRegistrationSelect,
      });

      const flattenedMembers = members.map((member) =>
        this.mapEventRegistrationRow(member),
      );

      return res.status(200).json({
        success: true,
        message: "Event registrations fetched successfully",
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
      const event_id = req.body?.event_id ?? req.query?.event_id;
      const user_id = req.body?.user_id ?? req.query?.user_id;

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
        select: eventRegistrationSelect,
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found for this event",
        });
      }

      // flatten
      const flattened = this.mapEventRegistrationRow(member);

      return res.status(200).json({
        success: true,
        message: "Registration fetched successfully",
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

  importBiometricAttendance = async (req: Request, res: Response) => {
    try {
      const actorUserId = this.getActorUserId(req);
      if (!actorUserId) {
        return res.status(401).json({
          success: false,
          message: "A valid authenticated user is required",
        });
      }

      const job = await biometricAttendanceService.createImportJob(
        req.body,
        {
          id: actorUserId,
        },
      );

      return res.status(202).json({
        success: true,
        message: job.dry_run
          ? "Biometric attendance preview job started"
          : "Biometric attendance import job started",
        data: job,
      });
    } catch (error: any) {
      const statusCode =
        error instanceof EventBiometricAttendanceImportError
          ? error.statusCode
          : 500;

      return res.status(statusCode).json({
        success: false,
        message:
          error instanceof EventBiometricAttendanceImportError
            ? error.message
            : "Unable to import biometric attendance",
        data:
          error instanceof EventBiometricAttendanceImportError
            ? null
            : error?.message || null,
      });
    }
  };

  getBiometricAttendanceImportJob = async (req: Request, res: Response) => {
    try {
      const jobId = this.toPositiveInt(req.query?.id);
      if (!jobId) {
        return res.status(400).json({
          success: false,
          message: "A valid job id is required",
        });
      }

      const job = await biometricAttendanceService.getImportJob(jobId);

      return res.status(200).json({
        success: true,
        message: "Biometric attendance import job fetched successfully",
        data: job,
      });
    } catch (error: any) {
      const statusCode =
        error instanceof EventBiometricAttendanceImportError
          ? error.statusCode
          : 500;

      return res.status(statusCode).json({
        success: false,
        message:
          error instanceof EventBiometricAttendanceImportError
            ? error.message
            : "Unable to fetch biometric attendance import job",
        data:
          error instanceof EventBiometricAttendanceImportError
            ? null
            : error?.message || null,
      });
    }
  };

  createAttendanceSummary = async (req: Request, res: Response) => {
    try {
      const {
        eventId,
        date,
        group = "BOTH",
        adultMale = 0,
        adultFemale = 0,
        childrenMale = 0,
        childrenFemale = 0,
        youthMale = 0,
        youthFemale = 0,
        visitors = 0,
        newMembers = 0,
        visitingPastors = 0,
        recordedBy,
        recordedByName,
      } = req.body;

      /* ---------------- Validation ---------------- */
      if (!eventId || !date || !recordedBy || !recordedByName) {
        return res.status(400).json({
          success: false,
          message: "eventId, date, recordedBy and recordedByName are required",
        });
      }

      const event_mgt_id = Number(eventId);
      if (Number.isNaN(event_mgt_id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid eventId",
        });
      }

      const attendanceDate = new Date(date);
      if (isNaN(attendanceDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date",
        });
      }

      // Normalize date (VERY important)
      attendanceDate.setHours(0, 0, 0, 0);

      /* ---------------- Transaction ---------------- */
      const record = await prisma.$transaction(async (tx) => {
        const event = await tx.event_mgt.findUnique({
          where: { id: event_mgt_id },
          select: { id: true },
        });

        if (!event) {
          throw new Error("EVENT_NOT_FOUND");
        }

        const existingSummary = await tx.event_attendance_summary.findUnique({
          where: {
            event_mgt_id_date: {
              event_mgt_id,
              date: attendanceDate,
            },
          },
        });

        if (existingSummary) {
          throw new Error("DUPLICATE_ATTENDANCE");
        }

        return tx.event_attendance_summary.create({
          data: {
            event_mgt_id,
            date: attendanceDate,
            group,
            adultMale: Number(adultMale) || 0,
            adultFemale: Number(adultFemale) || 0,
            childrenMale: Number(childrenMale) || 0,
            youthMale: Number(youthMale) || 0,
            youthFemale: Number(youthFemale) || 0,
            visitors: Number(visitors) || 0,
            newMembers: Number(newMembers) || 0,
            visitingPastors: Number(visitingPastors) || 0,
            childrenFemale: Number(childrenFemale) || 0,
            recordedBy: Number(recordedBy),
            recordedByName: recordedByName.trim(),
          },
        });
      });

      /* ---------------- Success Response ---------------- */
      return res.status(201).json({
        success: true,
        message: "Attendance recorded successfully",
        data: record,
      });
    } catch (error: any) {
      console.error(error);

      if (error.message === "EVENT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Event does not exist",
        });
      }

      if (error.message === "DUPLICATE_ATTENDANCE") {
        return res.status(409).json({
          success: false,
          message:
            "Attendance already recorded for this event on the same date",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Error creating attendance summary",
      });
    }
  };

  getAttendances = async (req: Request, res: Response) => {
    try {
      const { eventId, date } = req.query;

      const filter = {} as any;
      if (eventId) {
        const parsedEventId = Number(eventId);
        if (Number.isNaN(parsedEventId)) {
          return res.status(400).json({
            success: false,
            message: "eventId must be a valid number",
          });
        }
        filter.event_mgt_id = parsedEventId;
      }

      if (date) {
        const parsedDate = new Date(String(date));
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "date must be a valid date",
          });
        }

        // Accept date-based analytics at day granularity while still allowing
        // event-based filtering in the same query.
        const startOfDay = new Date(parsedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        filter.date = {
          gte: startOfDay,
          lt: endOfDay,
        };
      }

      const records = await prisma.event_attendance_summary.findMany({
        where: filter,
        include: {
          event: {
            include: {
              event: {
                select: { event_name: true },
              },
            },
          },
          recordedByUser: { select: { id: true, name: true } },
        },
        orderBy: { date: "desc" },
      });

      const formattedRecords = records.map((record) => ({
        id: record.id,
        date: record.date,
        group: record.group,
        adultMale: record.adultMale,
        adultFemale: record.adultFemale,
        childrenMale: record.childrenMale,
        childrenFemale: record.childrenFemale,
        recordedBy: record.recordedBy,
        recordedByName: record.recordedByName,
        created_at: record.created_at,
        updated_at: record.updated_at,
        eventId: record.event_mgt_id,
        event_name: record.event.event.event_name,
      }));

      res.json({ success: true, data: formattedRecords });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  getBiometricAttendances = async (req: Request, res: Response) => {
    try {
      const { eventId, date, fromDate, toDate } = req.query;

      const filter = {} as any;

      if (eventId) {
        const parsedEventId = Number(eventId);
        if (Number.isNaN(parsedEventId)) {
          return res.status(400).json({
            success: false,
            message: "eventId must be a valid number",
          });
        }

        filter.event_mgt_id = parsedEventId;
      }

      let startBoundary: Date | null = null;
      let endBoundary: Date | null = null;

      if (date) {
        const parsedDate = new Date(String(date));
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "date must be a valid date",
          });
        }

        startBoundary = new Date(parsedDate);
        startBoundary.setHours(0, 0, 0, 0);
        endBoundary = new Date(startBoundary);
        endBoundary.setDate(endBoundary.getDate() + 1);
      } else {
        if (fromDate) {
          const parsedFromDate = new Date(String(fromDate));
          if (Number.isNaN(parsedFromDate.getTime())) {
            return res.status(400).json({
              success: false,
              message: "fromDate must be a valid date",
            });
          }

          startBoundary = new Date(parsedFromDate);
          startBoundary.setHours(0, 0, 0, 0);
        }

        if (toDate) {
          const parsedToDate = new Date(String(toDate));
          if (Number.isNaN(parsedToDate.getTime())) {
            return res.status(400).json({
              success: false,
              message: "toDate must be a valid date",
            });
          }

          endBoundary = new Date(parsedToDate);
          endBoundary.setHours(0, 0, 0, 0);
          endBoundary.setDate(endBoundary.getDate() + 1);
        }
      }

      if (startBoundary || endBoundary) {
        filter.record_time = {};
        if (startBoundary) {
          filter.record_time.gte = startBoundary;
        }
        if (endBoundary) {
          filter.record_time.lt = endBoundary;
        }
      }

      const punches = await prisma.event_biometric_punch.findMany({
        where: {
          ...filter,
          matched_user_id: {
            not: null,
          },
        },
        include: {
          event: {
            select: {
              id: true,
              event_type: true,
              event: {
                select: {
                  event_name: true,
                },
              },
            },
          },
          matched_user: {
            select: {
              id: true,
              name: true,
              member_id: true,
            },
          },
        },
        orderBy: {
          record_time: "desc",
        },
      });

      const groupedRecords = new Map<
        string,
        {
          event_id: number;
          event_name: string | null;
          event_type: string | null;
          user_id: number;
          user_name: string | null;
          member_id: string | null;
          attendance_date: string;
          first_punch_at: Date;
          last_punch_at: Date;
          punch_count: number;
          device_ips: Set<string>;
        }
      >();

      for (const punch of punches) {
        if (!punch.matched_user_id || !punch.matched_user) {
          continue;
        }

        const attendanceDate = punch.record_time.toISOString().slice(0, 10);
        const key = [
          punch.event_mgt_id,
          punch.matched_user_id,
          attendanceDate,
        ].join(":");
        const existing = groupedRecords.get(key);

        if (!existing) {
          groupedRecords.set(key, {
            event_id: punch.event_mgt_id,
            event_name: punch.event?.event?.event_name || null,
            event_type: punch.event?.event_type || null,
            user_id: punch.matched_user_id,
            user_name: punch.matched_user.name,
            member_id: punch.matched_user.member_id,
            attendance_date: attendanceDate,
            first_punch_at: punch.record_time,
            last_punch_at: punch.record_time,
            punch_count: 1,
            device_ips: new Set([punch.device_ip]),
          });
          continue;
        }

        existing.punch_count += 1;
        existing.device_ips.add(punch.device_ip);
        if (punch.record_time < existing.first_punch_at) {
          existing.first_punch_at = punch.record_time;
        }
        if (punch.record_time > existing.last_punch_at) {
          existing.last_punch_at = punch.record_time;
        }
      }

      const groupedValues = Array.from(groupedRecords.values());
      const eventIds = Array.from(
        new Set(groupedValues.map((record) => record.event_id)),
      );
      const userIds = Array.from(
        new Set(groupedValues.map((record) => record.user_id)),
      );

      let existingAttendanceRows: Array<{
        id: number;
        event_id: number;
        user_id: number;
        created_at: Date;
      }> = [];

      if (groupedValues.length > 0 && eventIds.length > 0 && userIds.length > 0) {
        const attendanceRangeStart = groupedValues.reduce(
          (earliest, record) =>
            record.first_punch_at < earliest ? record.first_punch_at : earliest,
          groupedValues[0].first_punch_at,
        );
        const normalizedAttendanceRangeStart = new Date(attendanceRangeStart);
        normalizedAttendanceRangeStart.setHours(0, 0, 0, 0);
        const attendanceRangeEnd = groupedValues.reduce(
          (latest, record) =>
            record.last_punch_at > latest ? record.last_punch_at : latest,
          groupedValues[0].last_punch_at,
        );
        const endOfRange = new Date(attendanceRangeEnd);
        endOfRange.setHours(0, 0, 0, 0);
        endOfRange.setDate(endOfRange.getDate() + 1);

        existingAttendanceRows = await prisma.event_attendance.findMany({
          where: {
            event_id: {
              in: eventIds,
            },
            user_id: {
              in: userIds,
            },
            created_at: {
              gte: normalizedAttendanceRangeStart,
              lt: endOfRange,
            },
          },
          select: {
            id: true,
            event_id: true,
            user_id: true,
            created_at: true,
          },
        });
      }

      const attendanceLookup = new Map<
        string,
        {
          id: number;
          created_at: Date;
        }
      >();

      for (const attendanceRow of existingAttendanceRows) {
        const key = [
          attendanceRow.event_id,
          attendanceRow.user_id,
          attendanceRow.created_at.toISOString().slice(0, 10),
        ].join(":");

        if (!attendanceLookup.has(key)) {
          attendanceLookup.set(key, {
            id: attendanceRow.id,
            created_at: attendanceRow.created_at,
          });
        }
      }

      const records = groupedValues
        .map((record) => {
          const attendanceKey = [
            record.event_id,
            record.user_id,
            record.attendance_date,
          ].join(":");
          const attendanceRow = attendanceLookup.get(attendanceKey);

          return {
            event_id: record.event_id,
            event_name: record.event_name,
            event_type: record.event_type,
            user_id: record.user_id,
            user_name: record.user_name,
            member_id: record.member_id,
            attendance_date: record.attendance_date,
            first_punch_at: record.first_punch_at.toISOString(),
            last_punch_at: record.last_punch_at.toISOString(),
            punch_count: record.punch_count,
            device_ips: Array.from(record.device_ips).sort(),
            attendance_recorded: Boolean(attendanceRow),
            attendance_record_id: attendanceRow?.id || null,
          };
        })
        .sort((left, right) =>
          right.first_punch_at.localeCompare(left.first_punch_at),
        );

      const summary = {
        total_records: records.length,
        total_events: new Set(records.map((record) => record.event_id)).size,
        total_members: new Set(records.map((record) => record.user_id)).size,
        total_punches: records.reduce(
          (total, record) => total + record.punch_count,
          0,
        ),
        attendance_recorded: records.filter(
          (record) => record.attendance_recorded,
        ).length,
      };

      return res.json({
        success: true,
        data: {
          records,
          summary,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };

  getAttendanceById = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;

      const record = await prisma.event_attendance_summary.findUnique({
        where: { id: Number(id) },
      });

      if (!record) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      res.json({ success: true, data: record });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  updateAttendance = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;
      const { group, adultMale, adultFemale, childrenMale, childrenFemale } =
        req.body;

      const updated = await prisma.event_attendance_summary.update({
        where: { id: Number(id) },
        data: {
          group,
          adultMale: Number(adultMale) || 0,
          adultFemale: Number(adultFemale) || 0,
          childrenMale: Number(childrenMale) || 0,
          childrenFemale: Number(childrenFemale) || 0,
          updated_at: new Date(),
        },
      });

      res.json({
        success: true,
        message: "Attendance updated successfully",
        data: updated,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  deleteAttendance = async (req: Request, res: Response) => {
    try {
      const { id } = req.query;

      await prisma.event_attendance_summary.delete({
        where: { id: Number(id) },
      });

      res.json({
        success: true,
        message: "Attendance deleted successfully",
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
