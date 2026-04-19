import { promises as fs } from "fs";
import { EventReportStatus, Prisma } from "@prisma/client";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import puppeteer from "puppeteer";
import { resolve } from "path";
import {
  InputValidationError,
  NotFoundError,
  ResourceDuplicationError,
} from "../../utils/custom-error-handlers";
import { prisma } from "../../Models/context";
import {
  buildAttendanceVisitorCountsMap,
  getAttendanceVisitorCountsForRecord,
} from "../events/attendanceVisitorCounts";

type ApprovalWorkflowTx = Prisma.TransactionClient;

type DepartmentLinkedUser = {
  department_id: number | null;
  department: {
    department_id: number | null;
  } | null;
  department_positions: Array<{
    department_id: number;
  }>;
};

type DepartmentMemberInfo = {
  user_id: number;
  name: string;
};

type DepartmentAttendanceDetail = {
  id: number | null;
  user_id: number;
  name: string;
  arrival_time: string | null;
  reported_time: string;
  relative_to_start: string;
  status: "early" | "on_time" | "late" | "absent";
};

type EventReportDetailData = {
  event_id: number;
  event_name: string;
  event_date: string;
  departments: Array<{
    department_id: number;
    department_name: string;
    head_user_id: number | null;
    head_name: string | null;
    total_members: number;
    present_members: number;
    absent_members: number;
    attendance_percentage: number;
    attendees: DepartmentAttendanceDetail[];
  }>;
  department_summary: {
    total_members: number;
    present_members: number;
    attendance_percentage: number;
  };
  church_attendance: {
    adult_male: number;
    adult_female: number;
    children_male: number;
    children_female: number;
    youth_male: number;
    youth_female: number;
    visitors: number;
    visitor_breakdown: {
      visitors: {
        male: number;
        female: number;
        total: number;
      };
      visitor_clergy: {
        male: number;
        female: number;
        total: number;
      };
      total: {
        male: number;
        female: number;
        total: number;
      };
    };
    visitors_male: number;
    visitors_female: number;
    visitors_total: number;
    visitor_clergy_male: number;
    visitor_clergy_female: number;
    visitor_clergy_total: number;
    visitor_total_male: number;
    visitor_total_female: number;
    visitor_total: number;
    new_members: number;
    visiting_pastors: number;
    total_attendance: number;
  };
};

type ServiceSummaryFormat = "docx" | "pdf";

type ServiceSummaryFile = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
};

type ServiceSummaryPayload = {
  event_name: string;
  event_date: string;
  venue: string;
  start_time: string;
  closing_time: string;
  departments: EventReportDetailData["departments"];
  church_attendance: EventReportDetailData["church_attendance"];
};

const EVENT_REPORT_TX_MAX_WAIT_MS = 10_000;
const EVENT_REPORT_TX_TIMEOUT_MS = 90_000;
const SERVICE_SUMMARY_TEMPLATE_CANDIDATE_PATHS = [
  resolve(__dirname, "../../libs/eventReports/serviceSummaryTemplate.html"),
  resolve(process.cwd(), "dist/src/libs/eventReports/serviceSummaryTemplate.html"),
  resolve(process.cwd(), "src/libs/eventReports/serviceSummaryTemplate.html"),
];
const DOCX_PAGE_WIDTH_TWIPS = convertMillimetersToTwip(210);
const DOCX_PAGE_HEIGHT_TWIPS = convertMillimetersToTwip(297);
const DOCX_MARGIN_TOP_TWIPS = convertMillimetersToTwip(16);
const DOCX_MARGIN_RIGHT_TWIPS = convertMillimetersToTwip(12);
const DOCX_MARGIN_BOTTOM_TWIPS = convertMillimetersToTwip(16);
const DOCX_MARGIN_LEFT_TWIPS = convertMillimetersToTwip(12);
const DOCX_CONTENT_WIDTH_TWIPS =
  DOCX_PAGE_WIDTH_TWIPS - DOCX_MARGIN_LEFT_TWIPS - DOCX_MARGIN_RIGHT_TWIPS;
const DOCX_BORDER_COLOR = "111827";
const DOCX_HEADER_FILL = "F3F4F6";

const DOCX_TABLE_BORDERS = {
  top: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  bottom: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  left: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  right: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  insideHorizontal: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  insideVertical: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
} as const;

const DOCX_CELL_BORDERS = {
  top: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  bottom: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  left: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
  right: {
    style: BorderStyle.SINGLE,
    size: 8,
    color: DOCX_BORDER_COLOR,
  },
} as const;

const readServiceSummaryTemplateHtml = async (): Promise<string> => {
  for (const templatePath of SERVICE_SUMMARY_TEMPLATE_CANDIDATE_PATHS) {
    try {
      await fs.access(templatePath);
      return await fs.readFile(templatePath, "utf8");
    } catch {
      continue;
    }
  }

  throw new Error(
    `Service summary template file was not found. Checked: ${SERVICE_SUMMARY_TEMPLATE_CANDIDATE_PATHS.join(", ")}`,
  );
};

const runEventReportTransaction = async <T>(
  operation: (tx: ApprovalWorkflowTx) => Promise<T>,
): Promise<T> =>
  prisma.$transaction((tx) => operation(tx), {
    maxWait: EVENT_REPORT_TX_MAX_WAIT_MS,
    timeout: EVENT_REPORT_TX_TIMEOUT_MS,
  });

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parseEventDateString = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  const utcDate = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(utcDate.getTime())) {
    throw new InputValidationError("event_date must be in YYYY-MM-DD format");
  }

  return trimmed;
};

const toUtcDayDate = (dateString: string): Date =>
  new Date(`${dateString}T00:00:00.000Z`);

const toYmdDateString = (value: Date): string => value.toISOString().slice(0, 10);

const getUtcDayBounds = (dateString: string) => {
  const start = toUtcDayDate(dateString);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
};

const uniquePositiveIds = (values: number[]): number[] =>
  Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort(
    (left, right) => left - right,
  );

const formatDisplayDate = (dateString: string): string => {
  const value = toUtcDayDate(dateString);
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

const getTodayDateString = (): string => toYmdDateString(new Date());

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slugifyFilePart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";

const parseOptionalDate = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseEventDateString(value);
};

const formatReportedTime = (value: Date | null | undefined): string | null => {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString().slice(11, 19);
};

const formatRelativeToStart = (
  arrivalTime: Date,
  eventStartTime: Date | null,
): string => {
  if (!eventStartTime) {
    return "-";
  }

  const differenceInMinutes = Math.round(
    (arrivalTime.getTime() - eventStartTime.getTime()) / 60000,
  );

  if (differenceInMinutes === 0) {
    return "0m";
  }

  const absoluteMinutes = Math.abs(differenceInMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const parts = [
    ...(hours ? [`${hours}h`] : []),
    ...(minutes || !hours ? [`${minutes}m`] : []),
  ];

  return `${differenceInMinutes > 0 ? "+" : "-"}${parts.join(" ")}`;
};

const getReportedAttendanceStatus = (
  arrivalTime: Date,
  eventStartTime: Date | null,
): "early" | "on_time" | "late" => {
  if (!eventStartTime) {
    return "on_time";
  }

  if (arrivalTime.getTime() < eventStartTime.getTime()) {
    return "early";
  }

  if (arrivalTime.getTime() > eventStartTime.getTime()) {
    return "late";
  }

  return "on_time";
};

const formatAttendanceStatusLabel = (
  status: DepartmentAttendanceDetail["status"],
): string => {
  switch (status) {
    case "early":
      return "Early";
    case "late":
      return "Late";
    case "absent":
      return "Absent";
    case "on_time":
    default:
      return "On Time";
  }
};

const buildReportEventStartDateTime = (
  eventDate: string,
  eventStartTime: string | null | undefined,
  eventStartDate: Date | null | undefined,
): Date | null => {
  const reportEventStart = toUtcDayDate(eventDate);
  const normalizedStartTime = String(eventStartTime || "").trim();
  const timeMatch = normalizedStartTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (timeMatch) {
    reportEventStart.setUTCHours(
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] || 0),
      0,
    );
    return reportEventStart;
  }

  if (!eventStartDate) {
    return null;
  }

  reportEventStart.setUTCHours(
    eventStartDate.getUTCHours(),
    eventStartDate.getUTCMinutes(),
    eventStartDate.getUTCSeconds(),
    eventStartDate.getUTCMilliseconds(),
  );

  return reportEventStart;
};

const getUserDepartmentIds = (
  user: DepartmentLinkedUser,
  validDepartmentIdSet: Set<number>,
): number[] => {
  const departmentIds = new Set<number>();

  if (
    typeof user.department?.department_id === "number" &&
    validDepartmentIdSet.has(user.department.department_id)
  ) {
    departmentIds.add(user.department.department_id);
  }

  if (
    typeof user.department_id === "number" &&
    validDepartmentIdSet.has(user.department_id)
  ) {
    departmentIds.add(user.department_id);
  }

  for (const departmentPosition of user.department_positions) {
    if (validDepartmentIdSet.has(departmentPosition.department_id)) {
      departmentIds.add(departmentPosition.department_id);
    }
  }

  return Array.from(departmentIds).sort((left, right) => left - right);
};

const getDepartmentMembersByDepartmentTx = async (
  tx: ApprovalWorkflowTx,
  validDepartmentIdSet: Set<number>,
) => {
  const users = await tx.user.findMany({
    select: {
      id: true,
      name: true,
      department_id: true,
      department: {
        select: {
          department_id: true,
        },
      },
      department_positions: {
        select: {
          department_id: true,
        },
      },
    },
  });

  const membersByDepartment = new Map<number, Map<number, DepartmentMemberInfo>>();

  for (const user of users as unknown as DepartmentLinkedUser[] & Array<{ id: number; name: string }>) {
    const departmentIds = getUserDepartmentIds(user, validDepartmentIdSet);

    for (const departmentId of departmentIds) {
      const members = membersByDepartment.get(departmentId) || new Map();
      members.set((user as unknown as { id: number }).id, {
        user_id: (user as unknown as { id: number }).id,
        name: (user as unknown as { name: string }).name,
      });
      membersByDepartment.set(departmentId, members);
    }
  }

  return membersByDepartment;
};

const loadEventByIdTx = async (tx: ApprovalWorkflowTx, eventId: number) => {
  const event = await tx.event_mgt.findUnique({
    where: {
      id: eventId,
    },
    select: {
      id: true,
      created_by: true,
      start_date: true,
      start_time: true,
      end_time: true,
      location: true,
      event: {
        select: {
          event_name: true,
        },
      },
    },
  });

  if (!event) {
    throw new NotFoundError("Event not found");
  }

  return event;
};

const findEventReportByDateTx = async (
  tx: ApprovalWorkflowTx,
  eventId: number,
  eventDate: string,
) => {
  const { start, end } = getUtcDayBounds(eventDate);

  return tx.event_reports.findFirst({
    where: {
      event_id: eventId,
      event_date: {
        gte: start,
        lt: end,
      },
    },
    select: {
      id: true,
      event_id: true,
      event_date: true,
      status: true,
      created_by: true,
      updated_by: true,
      created_at: true,
      updated_at: true,
    },
  });
};

const createEventReportTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
    actorUserId: number;
  },
) => {
  try {
    return await tx.event_reports.create({
      data: {
        event_id: args.eventId,
        event_date: toUtcDayDate(args.eventDate),
        status: EventReportStatus.DRAFT,
        created_by: args.actorUserId,
        updated_by: args.actorUserId,
      },
      select: {
        id: true,
        event_id: true,
        event_date: true,
        status: true,
        created_by: true,
        updated_by: true,
        created_at: true,
        updated_at: true,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ResourceDuplicationError("Report has already been generated for this event");
    }

    throw error;
  }
};

const validateRequestedEventOccurrence = (
  event: Awaited<ReturnType<typeof loadEventByIdTx>>,
  eventDate: string,
) => {
  if (!event.start_date) {
    throw new InputValidationError("Event does not have a valid start date");
  }

  const eventStartDate = toYmdDateString(event.start_date);
  if (eventStartDate !== eventDate) {
    throw new InputValidationError("Event occurrence does not exist");
  }

  if (eventDate > getTodayDateString()) {
    throw new InputValidationError("Future events cannot be used to generate reports");
  }
};

const assertReportDataAvailableTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);
  const [eventAttendanceCount, churchAttendanceCount] = await Promise.all([
    tx.event_attendance.count({
      where: {
        event_id: args.eventId,
        created_at: {
          gte: start,
          lt: end,
        },
      },
    }),
    tx.event_attendance_summary.count({
      where: {
        event_mgt_id: args.eventId,
        date: {
          gte: start,
          lt: end,
        },
      },
    }),
  ]);

  if (!eventAttendanceCount || !churchAttendanceCount) {
    throw new InputValidationError("No event or church attendance data");
  }
};

const getDepartmentBreakdownTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
    eventStartTime: string | null;
    eventStartDate: Date | null;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);
  const reportEventStartTime = buildReportEventStartDateTime(
    args.eventDate,
    args.eventStartTime,
    args.eventStartDate,
  );

  const attendanceRows = await tx.event_attendance.findMany({
    where: {
      event_id: args.eventId,
      created_at: {
        gte: start,
        lt: end,
      },
    },
    orderBy: {
      created_at: "asc",
    },
    select: {
      id: true,
      user_id: true,
      created_at: true,
      user: {
        select: {
          id: true,
          name: true,
          department_id: true,
          department: {
            select: {
              department_id: true,
            },
          },
          department_positions: {
            orderBy: {
              department_id: "asc",
            },
            select: {
              department_id: true,
            },
          },
        },
      },
    },
  });

  const departments = await tx.department.findMany({
    include: {
      department_head_info: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const validDepartmentIdSet = new Set(departments.map((department) => department.id));
  const membersByDepartment = await getDepartmentMembersByDepartmentTx(
    tx,
    validDepartmentIdSet,
  );

  const attendeeByDepartment = new Map<
    number,
    Map<
      number,
      {
        id: number;
        user_id: number;
        name: string;
        arrival_time: Date;
      }
    >
  >();

  for (const row of attendanceRows as Array<{
    id: number;
    user_id: number;
    created_at: Date;
    user: DepartmentLinkedUser & { name: string };
  }>) {
    const departmentIds = getUserDepartmentIds(row.user, validDepartmentIdSet);
    if (!departmentIds.length) {
      continue;
    }

    for (const departmentId of departmentIds) {
      const bucket = attendeeByDepartment.get(departmentId) || new Map();
      const existingAttendee = bucket.get(row.user_id);

      if (!existingAttendee || row.created_at < existingAttendee.arrival_time) {
        bucket.set(row.user_id, {
          id: row.id,
          user_id: row.user_id,
          name: row.user.name,
          arrival_time: row.created_at,
        });
      }

      attendeeByDepartment.set(departmentId, bucket);
    }
  }

  const departmentBlocks = departments
    .map((department) => {
      const attendeeMap = attendeeByDepartment.get(department.id) || new Map();
      const memberMap = membersByDepartment.get(department.id) || new Map();
      const absentAttendees: DepartmentAttendanceDetail[] = [];
      const presentAttendees: DepartmentAttendanceDetail[] = [];

      for (const member of memberMap.values()) {
        const attendee = attendeeMap.get(member.user_id);
        const reportedTime = formatReportedTime(attendee?.arrival_time);

        if (!attendee || !reportedTime) {
          absentAttendees.push({
            id: null,
            user_id: member.user_id,
            name: member.name,
            arrival_time: null,
            reported_time: "-",
            relative_to_start: "-",
            status: "absent",
          });
          continue;
        }

        presentAttendees.push({
          id: attendee.id,
          user_id: attendee.user_id,
          name: attendee.name,
          arrival_time: attendee.arrival_time.toISOString(),
          reported_time: reportedTime,
          relative_to_start: formatRelativeToStart(
            attendee.arrival_time,
            reportEventStartTime,
          ),
          status: getReportedAttendanceStatus(
            attendee.arrival_time,
            reportEventStartTime,
          ),
        });
      }

      presentAttendees.sort(
        (left, right) =>
          new Date(left.arrival_time || 0).getTime() -
          new Date(right.arrival_time || 0).getTime(),
      );
      absentAttendees.sort((left, right) => left.name.localeCompare(right.name));

      const totalMembers = memberMap.size;
      const presentMembers = presentAttendees.length;
      const absentMembers = Math.max(totalMembers - presentMembers, 0);
      const attendancePercentage =
        totalMembers > 0
          ? Number(((presentMembers / totalMembers) * 100).toFixed(1))
          : 0;

      return {
        department_id: department.id,
        department_name: department.name,
        head_user_id: department.department_head || null,
        head_name: department.department_head_info?.name || null,
        total_members: totalMembers,
        present_members: presentMembers,
        absent_members: absentMembers,
        attendance_percentage: attendancePercentage,
        attendees: [...presentAttendees, ...absentAttendees],
      };
    })
    .filter(
      (department) => department.total_members > 0 || department.present_members > 0,
    );

  return {
    departments: departmentBlocks,
    total_members: departmentBlocks.reduce(
      (total, department) => total + department.total_members,
      0,
    ),
    present_members: departmentBlocks.reduce(
      (total, department) => total + department.present_members,
      0,
    ),
  };
};

const getChurchAttendanceBlockTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
  },
) => {
  const { start, end } = getUtcDayBounds(args.eventDate);

  const attendanceSummary = await tx.event_attendance_summary.findFirst({
    where: {
      event_mgt_id: args.eventId,
      date: {
        gte: start,
        lt: end,
      },
    },
    orderBy: {
      date: "desc",
    },
  });

  const attendanceReferenceDate = attendanceSummary?.date || toUtcDayDate(args.eventDate);
  const visitorCountsByKey = await buildAttendanceVisitorCountsMap(
    [
      {
        eventId: args.eventId,
        date: attendanceReferenceDate,
      },
    ],
    tx,
  );
  const visitorCounts = getAttendanceVisitorCountsForRecord(
    visitorCountsByKey,
    args.eventId,
    attendanceReferenceDate,
  );

  const adultMale = Number(attendanceSummary?.adultMale || 0);
  const adultFemale = Number(attendanceSummary?.adultFemale || 0);
  const childrenMale = Number(attendanceSummary?.childrenMale || 0);
  const childrenFemale = Number(attendanceSummary?.childrenFemale || 0);
  const youthMale = Number(attendanceSummary?.youthMale || 0);
  const youthFemale = Number(attendanceSummary?.youthFemale || 0);
  const visitors = visitorCounts.total.total;
  const newMembers = Number(attendanceSummary?.newMembers || 0);
  const visitingPastors = Number(
    attendanceSummary?.visitingPastors || visitorCounts.visitorClergy.total || 0,
  );

  return {
    church_attendance: {
      adult_male: adultMale,
      adult_female: adultFemale,
      children_male: childrenMale,
      children_female: childrenFemale,
      youth_male: youthMale,
      youth_female: youthFemale,
      visitors,
      visitor_breakdown: {
        visitors: visitorCounts.visitors,
        visitor_clergy: visitorCounts.visitorClergy,
        total: visitorCounts.total,
      },
      visitors_male: visitorCounts.visitors.male,
      visitors_female: visitorCounts.visitors.female,
      visitors_total: visitorCounts.visitors.total,
      visitor_clergy_male: visitorCounts.visitorClergy.male,
      visitor_clergy_female: visitorCounts.visitorClergy.female,
      visitor_clergy_total: visitorCounts.visitorClergy.total,
      visitor_total_male: visitorCounts.total.male,
      visitor_total_female: visitorCounts.total.female,
      visitor_total: visitorCounts.total.total,
      new_members: newMembers,
      visiting_pastors: visitingPastors,
      total_attendance:
        adultMale +
        adultFemale +
        childrenMale +
        childrenFemale +
        youthMale +
        youthFemale +
        visitors,
    },
  };
};

const buildEventReportDetailDataTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
  },
): Promise<EventReportDetailData> => {
  const event = await loadEventByIdTx(tx, args.eventId);
  const report = await findEventReportByDateTx(tx, args.eventId, args.eventDate);
  if (!report) {
    throw new NotFoundError("Event report not found");
  }

  const [departmentBlock, churchAttendanceBlock] = await Promise.all([
    getDepartmentBreakdownTx(tx, {
      eventId: args.eventId,
      eventDate: args.eventDate,
      eventStartTime: event.start_time,
      eventStartDate: event.start_date,
    }),
    getChurchAttendanceBlockTx(tx, {
      eventId: args.eventId,
      eventDate: args.eventDate,
    }),
  ]);

  return {
    event_id: report.event_id,
    event_name: event.event?.event_name || "Unknown Event",
    event_date: args.eventDate,
    departments: departmentBlock.departments,
    department_summary: {
      total_members: departmentBlock.total_members,
      present_members: departmentBlock.present_members,
      attendance_percentage:
        departmentBlock.total_members > 0
          ? Number(
              (
                (departmentBlock.present_members / departmentBlock.total_members) *
                100
              ).toFixed(1),
            )
          : 0,
    },
    church_attendance: churchAttendanceBlock.church_attendance,
  };
};

const getServiceSummaryPayloadTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    eventId: number;
    eventDate: string;
  },
): Promise<ServiceSummaryPayload> => {
  const event = await loadEventByIdTx(tx, args.eventId);
  const detail = await buildEventReportDetailDataTx(tx, args);

  return {
    event_name: detail.event_name,
    event_date: detail.event_date,
    venue: event.location || "-",
    start_time: event.start_time || "-",
    closing_time: event.end_time || "-",
    departments: detail.departments,
    church_attendance: detail.church_attendance,
  };
};

const renderDepartmentRowsHtml = (
  attendees: DepartmentAttendanceDetail[],
): string => {
  if (!attendees.length) {
    return `
      <tr>
        <td colspan="4" class="empty-row">No attendance rows recorded for this department.</td>
      </tr>
    `;
  }

  return attendees
    .map(
      (attendee) => `
        <tr>
          <td>${escapeHtml(attendee.reported_time)}</td>
          <td>${escapeHtml(attendee.name)}</td>
          <td>${escapeHtml(attendee.relative_to_start)}</td>
          <td>${escapeHtml(formatAttendanceStatusLabel(attendee.status))}</td>
        </tr>
      `,
    )
    .join("");
};

const renderDepartmentSectionsHtml = (
  departments: ServiceSummaryPayload["departments"],
): string =>
  departments
    .map(
      (department) => `
        <section class="department-section">
          <div class="department-title">${escapeHtml(department.department_name)}</div>
          <table class="department-table">
            <thead>
              <tr>
                <th>Arrival Time</th>
                <th>Name</th>
                <th>Relative To Start</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${renderDepartmentRowsHtml(department.attendees)}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

const renderSummaryRowsHtml = (
  churchAttendance: ServiceSummaryPayload["church_attendance"],
): string => {
  const rows = [
    ["Male", churchAttendance.adult_male],
    ["Female", churchAttendance.adult_female],
    ["Youth", churchAttendance.youth_male + churchAttendance.youth_female],
    ["Children", churchAttendance.children_male + churchAttendance.children_female],
    ["Visitors", churchAttendance.visitors],
    ["New Members", churchAttendance.new_members],
    ["Visiting Pastors", churchAttendance.visiting_pastors],
    ["Tot. Attendance", churchAttendance.total_attendance],
  ];

  return rows
    .map(
      ([label, value]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td>${escapeHtml(value)}</td>
        </tr>
      `,
    )
    .join("");
};

const renderServiceSummaryHtml = async (
  payload: ServiceSummaryPayload,
): Promise<string> => {
  const template = await readServiceSummaryTemplateHtml();
  const replacements: Record<string, string> = {
    "{{REPORT_DATE}}": escapeHtml(formatDisplayDate(payload.event_date)),
    "{{EVENT_NAME}}": escapeHtml(payload.event_name),
    "{{EVENT_DATE}}": escapeHtml(formatDisplayDate(payload.event_date)),
    "{{VENUE}}": escapeHtml(payload.venue),
    "{{START_TIME}}": escapeHtml(payload.start_time),
    "{{CLOSING_TIME}}": escapeHtml(payload.closing_time),
    "{{DEPARTMENT_SECTIONS}}": renderDepartmentSectionsHtml(payload.departments),
    "{{REGISTRY_SUMMARY_ROWS}}": renderSummaryRowsHtml(payload.church_attendance),
  };

  return Object.entries(replacements).reduce(
    (currentHtml, [token, value]) => currentHtml.split(token).join(value),
    template,
  );
};

const toDocxColumnWidth = (ratio: number): number =>
  Math.round(DOCX_CONTENT_WIDTH_TWIPS * ratio);

const createDocxParagraph = (
  text: string,
  options?: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    bold?: boolean;
    size?: number;
    allCaps?: boolean;
    spacingBefore?: number;
    spacingAfter?: number;
  },
): Paragraph =>
  new Paragraph({
    alignment: options?.alignment,
    spacing: {
      before: options?.spacingBefore,
      after: options?.spacingAfter,
    },
    children: [
      new TextRun({
        text,
        font: "Times New Roman",
        bold: options?.bold,
        size: options?.size,
        allCaps: options?.allCaps,
      }),
    ],
  });

const createDocxCell = (
  text: string,
  options?: {
    width?: number;
    bold?: boolean;
    fill?: string;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  },
): TableCell =>
  new TableCell({
    width: options?.width
      ? {
          size: options.width,
          type: WidthType.DXA,
        }
      : undefined,
    shading: options?.fill
      ? {
          fill: options.fill,
        }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: DOCX_CELL_BORDERS,
    margins: {
      top: 100,
      bottom: 100,
      left: 120,
      right: 120,
    },
    children: [
      createDocxParagraph(text, {
        bold: options?.bold,
        alignment: options?.alignment,
        size: 22,
      }),
    ],
  });

const createDocxKeyValueCell = (
  label: string,
  value: string,
  width: number,
): TableCell =>
  new TableCell({
    width: {
      size: width,
      type: WidthType.DXA,
    },
    borders: DOCX_CELL_BORDERS,
    margins: {
      top: 120,
      bottom: 120,
      left: 140,
      right: 140,
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: `${label}: `,
            font: "Times New Roman",
            bold: true,
            size: 22,
          }),
          new TextRun({
            text: value,
            font: "Times New Roman",
            size: 22,
          }),
        ],
      }),
    ],
  });

const createDocxTable = (
  rows: TableRow[],
  columnWidths: number[],
): Table =>
  new Table({
    width: {
      size: DOCX_CONTENT_WIDTH_TWIPS,
      type: WidthType.DXA,
    },
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: DOCX_TABLE_BORDERS,
    columnWidths,
    rows,
  });

const createDepartmentDocxTable = (
  attendees: DepartmentAttendanceDetail[],
): Table => {
  const columnWidths = [0.18, 0.36, 0.22, 0.24].map(toDocxColumnWidth);
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        createDocxCell("Arrival Time", {
          width: columnWidths[0],
          bold: true,
          fill: DOCX_HEADER_FILL,
        }),
        createDocxCell("Name", {
          width: columnWidths[1],
          bold: true,
          fill: DOCX_HEADER_FILL,
        }),
        createDocxCell("Relative To Start", {
          width: columnWidths[2],
          bold: true,
          fill: DOCX_HEADER_FILL,
        }),
        createDocxCell("Status", {
          width: columnWidths[3],
          bold: true,
          fill: DOCX_HEADER_FILL,
        }),
      ],
    }),
  ];

  if (!attendees.length) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 4,
            width: {
              size: DOCX_CONTENT_WIDTH_TWIPS,
              type: WidthType.DXA,
            },
            verticalAlign: VerticalAlign.CENTER,
            borders: DOCX_CELL_BORDERS,
            margins: {
              top: 100,
              bottom: 100,
              left: 120,
              right: 120,
            },
            children: [
              createDocxParagraph("No attendance rows recorded for this department.", {
                alignment: AlignmentType.CENTER,
                size: 22,
              }),
            ],
          }),
        ],
      }),
    );
    return createDocxTable(rows, columnWidths);
  }

  rows.push(
    ...attendees.map(
      (attendee) =>
        new TableRow({
          children: [
            createDocxCell(attendee.reported_time, {
              width: columnWidths[0],
            }),
            createDocxCell(attendee.name, {
              width: columnWidths[1],
            }),
            createDocxCell(attendee.relative_to_start, {
              width: columnWidths[2],
            }),
            createDocxCell(formatAttendanceStatusLabel(attendee.status), {
              width: columnWidths[3],
            }),
          ],
        }),
    ),
  );

  return createDocxTable(rows, columnWidths);
};

const createRegistrySummaryDocxTable = (
  churchAttendance: ServiceSummaryPayload["church_attendance"],
): Table => {
  const columnWidths = [toDocxColumnWidth(0.4), toDocxColumnWidth(0.6)];
  const rows = [
    ["Male", churchAttendance.adult_male],
    ["Female", churchAttendance.adult_female],
    ["Youth", churchAttendance.youth_male + churchAttendance.youth_female],
    ["Children", churchAttendance.children_male + churchAttendance.children_female],
    ["Visitors", churchAttendance.visitors],
    ["New Members", churchAttendance.new_members],
    ["Visiting Pastors", churchAttendance.visiting_pastors],
    ["Tot. Attendance", churchAttendance.total_attendance],
  ].map(
    ([label, value]) =>
      new TableRow({
        children: [
          createDocxCell(String(label), {
            width: columnWidths[0],
            bold: true,
            fill: DOCX_HEADER_FILL,
          }),
          createDocxCell(String(value), {
            width: columnWidths[1],
          }),
        ],
      }),
  );

  return createDocxTable(rows, columnWidths);
};

const generateDocxBufferFromSummary = async (
  payload: ServiceSummaryPayload,
): Promise<Buffer> => {
  try {
    const halfWidth = Math.round(DOCX_CONTENT_WIDTH_TWIPS / 2);
    const children: Array<Paragraph | Table> = [
      createDocxParagraph("WORLDWIDE WORD MINISTRIES", {
        alignment: AlignmentType.CENTER,
        bold: true,
        size: 28,
        allCaps: true,
        spacingAfter: 80,
      }),
      createDocxParagraph("SERVICE SUMMARY REPORT", {
        alignment: AlignmentType.CENTER,
        bold: true,
        size: 26,
        allCaps: true,
        spacingAfter: 80,
      }),
      createDocxParagraph(formatDisplayDate(payload.event_date), {
        alignment: AlignmentType.CENTER,
        size: 22,
        spacingAfter: 220,
      }),
      createDocxParagraph(payload.event_name, {
        bold: true,
        size: 24,
        allCaps: true,
        spacingAfter: 100,
      }),
      createDocxTable(
        [
          new TableRow({
            children: [
              createDocxKeyValueCell("Date", formatDisplayDate(payload.event_date), halfWidth),
              createDocxKeyValueCell("Venue", payload.venue, halfWidth),
            ],
          }),
          new TableRow({
            children: [
              createDocxKeyValueCell("Start Time", payload.start_time, halfWidth),
              createDocxKeyValueCell("Closing Time", payload.closing_time, halfWidth),
            ],
          }),
        ],
        [halfWidth, halfWidth],
      ),
    ];

    for (const department of payload.departments) {
      children.push(
        createDocxParagraph(department.department_name, {
          bold: true,
          size: 24,
          allCaps: true,
          spacingBefore: 220,
          spacingAfter: 100,
        }),
        createDepartmentDocxTable(department.attendees),
      );
    }

    children.push(
      createDocxParagraph("Registry Summary", {
        bold: true,
        size: 24,
        allCaps: true,
        spacingBefore: 220,
        spacingAfter: 100,
      }),
      createRegistrySummaryDocxTable(payload.church_attendance),
    );

    const document = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: DOCX_PAGE_WIDTH_TWIPS,
                height: DOCX_PAGE_HEIGHT_TWIPS,
                orientation: PageOrientation.PORTRAIT,
              },
              margin: {
                top: DOCX_MARGIN_TOP_TWIPS,
                right: DOCX_MARGIN_RIGHT_TWIPS,
                bottom: DOCX_MARGIN_BOTTOM_TWIPS,
                left: DOCX_MARGIN_LEFT_TWIPS,
              },
            },
          },
          children,
        },
      ],
    });

    return await Packer.toBuffer(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InputValidationError(`Unable to generate DOCX report: ${message}`);
  }
};

const generatePdfBufferFromHtml = async (html: string): Promise<Buffer> => {
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "16mm",
        right: "12mm",
        bottom: "16mm",
        left: "12mm",
      },
    });

    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
};

const buildOverviewGrouping = (
  rows: Array<{
    id: number;
    event_id: number;
    event_name: string;
    event_date: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>,
  groupBy: string,
) => {
  if (!groupBy || groupBy === "none") {
    return [];
  }

  const buckets = new Map<
    string,
    {
      key: string;
      label: string;
      count: number;
      items: typeof rows;
    }
  >();

  const resolveGroup = (row: (typeof rows)[number]) => {
    if (groupBy === "event_name") {
      return {
        key: row.event_name,
        label: row.event_name,
      };
    }

    if (groupBy === "status") {
      return {
        key: row.status,
        label: row.status,
      };
    }

    if (groupBy === "day") {
      return {
        key: row.event_date,
        label: row.event_date,
      };
    }

    if (groupBy === "month") {
      const key = row.event_date.slice(0, 7);
      return {
        key,
        label: key,
      };
    }

    if (groupBy === "week") {
      const eventDate = toUtcDayDate(row.event_date);
      const weekDay = eventDate.getUTCDay() || 7;
      const weekStart = new Date(eventDate);
      weekStart.setUTCDate(eventDate.getUTCDate() - (weekDay - 1));
      const key = toYmdDateString(weekStart);

      return {
        key,
        label: `Week of ${key}`,
      };
    }

    return {
      key: "all",
      label: "All reports",
    };
  };

  for (const row of rows) {
    const group = resolveGroup(row);
    const bucket =
      buckets.get(group.key) ||
      {
        key: group.key,
        label: group.label,
        count: 0,
        items: [],
      };

    bucket.items.push(row);
    bucket.count += 1;
    buckets.set(group.key, bucket);
  }

  return Array.from(buckets.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
};

export const listEligibleEventReports = async () => {
  const today = getTodayDateString();

  const [events, reports] = await Promise.all([
    prisma.event_mgt.findMany({
      where: {
        start_date: {
          not: null,
          lte: new Date(`${today}T23:59:59.999Z`),
        },
      },
      orderBy: {
        start_date: "desc",
      },
      select: {
        id: true,
        start_date: true,
        event: {
          select: {
            event_name: true,
          },
        },
      },
    }),
    prisma.event_reports.findMany({
      select: {
        event_id: true,
        event_date: true,
      },
    }),
  ]);

  const existingReportKeys = new Set(
    reports.map((report) => `${report.event_id}:${toYmdDateString(report.event_date)}`),
  );

  const data = events
    .filter((event) => event.start_date)
    .map((event) => {
      const eventDate = toYmdDateString(event.start_date as Date);
      return {
        event_id: event.id,
        event_date: eventDate,
        event_name: event.event?.event_name || "Unknown Event",
      };
    })
    .filter((event) => !existingReportKeys.has(`${event.event_id}:${event.event_date}`))
    .map((event) => ({
      ...event,
      label: `${event.event_name} - ${event.event_date}`,
    }));

  return {
    data,
  };
};

export const generateEventReport = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
  },
  user: any,
) => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const actorUserId = toPositiveInt(user?.id);
  if (!actorUserId) {
    throw new InputValidationError("Authenticated user not found");
  }

  const eventDate = parseEventDateString(payload.event_date);

  return runEventReportTransaction(async (tx) => {
    const event = await loadEventByIdTx(tx, eventId);
    validateRequestedEventOccurrence(event, eventDate);

    const existingReport = await findEventReportByDateTx(tx, eventId, eventDate);
    if (existingReport) {
      throw new ResourceDuplicationError(
        "Report has already been generated for this event",
      );
    }

    await assertReportDataAvailableTx(tx, {
      eventId,
      eventDate,
    });

    const report = await createEventReportTx(tx, {
      eventId,
      eventDate,
      actorUserId,
    });

    return {
      data: {
        id: report.id,
        event_id: report.event_id,
        event_date: eventDate,
        event_name: event.event?.event_name || "Unknown Event",
        status: report.status,
      },
    };
  });
};

export const getEventReportDetail = async (
  query: {
    event_id?: unknown;
    event_date?: unknown;
  },
) => {
  const eventId = toPositiveInt(query.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(query.event_date);

  return runEventReportTransaction(async (tx) => ({
    data: await buildEventReportDetailDataTx(tx, {
      eventId,
      eventDate,
    }),
  }));
};

export const getEventReportOverview = async (query: {
  search?: unknown;
  status?: unknown;
  group_by?: unknown;
  date_scope?: unknown;
  event_id?: unknown;
  from_date?: unknown;
  to_date?: unknown;
  month?: unknown;
  year?: unknown;
}) => {
  const search =
    typeof query.search === "string" && query.search.trim()
      ? query.search.trim()
      : null;
  const status =
    typeof query.status === "string" && query.status.trim()
      ? query.status.trim()
      : null;
  const groupBy =
    typeof query.group_by === "string" && query.group_by.trim()
      ? query.group_by.trim()
      : "none";
  const dateScope =
    typeof query.date_scope === "string" && query.date_scope.trim().toLowerCase() === "month"
      ? "month"
      : "all";
  const eventId = toPositiveInt(query.event_id);

  let fromDate = parseOptionalDate(query.from_date);
  let toDate = parseOptionalDate(query.to_date);

  if (
    !fromDate &&
    !toDate &&
    dateScope === "month" &&
    query.month !== undefined &&
    query.year !== undefined
  ) {
    const month = Number(query.month);
    const year = Number(query.year);
    if (
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      Number.isInteger(year) &&
      year > 0
    ) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0));
      fromDate = toYmdDateString(start);
      toDate = toYmdDateString(end);
    }
  }

  const reports = await prisma.event_reports.findMany({
    where: {
      event_id: eventId || undefined,
      status: status ? (status as EventReportStatus) : undefined,
      event_date:
        fromDate || toDate
          ? {
              ...(fromDate ? { gte: toUtcDayDate(fromDate) } : {}),
              ...(toDate
                ? {
                    lt: new Date(`${toDate}T23:59:59.999Z`),
                  }
                : {}),
            }
          : undefined,
      event: search
        ? {
            event: {
              event_name: {
                contains: search,
              },
            },
          }
        : undefined,
    },
    orderBy: {
      event_date: "desc",
    },
    select: {
      id: true,
      event_id: true,
      event_date: true,
      status: true,
      created_at: true,
      updated_at: true,
      event: {
        select: {
          event: {
            select: {
              event_name: true,
            },
          },
        },
      },
    },
  });

  const data = reports.map((report) => ({
    id: report.id,
    event_id: report.event_id,
    event_name: report.event?.event?.event_name || "Unknown Event",
    event_date: toYmdDateString(report.event_date),
    report_status: report.status,
    status: report.status,
    generated_at: report.created_at.toISOString(),
    created_at: report.created_at.toISOString(),
    updated_at: report.updated_at.toISOString(),
  }));

  return {
    data,
    grouped_data: buildOverviewGrouping(data, groupBy),
    meta: {
      total: data.length,
      group_by: groupBy,
      filters: {
        date_scope: dateScope,
        search,
        status,
        event_id: eventId,
        from_date: fromDate,
        to_date: toDate,
      },
    },
  };
};

export const generateServiceSummaryReport = async (
  payload: {
    event_id?: unknown;
    event_date?: unknown;
    format?: unknown;
  },
): Promise<ServiceSummaryFile> => {
  const eventId = toPositiveInt(payload.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(payload.event_date);
  const format = String(payload.format || "")
    .trim()
    .toLowerCase() as ServiceSummaryFormat;

  if (format !== "docx" && format !== "pdf") {
    throw new InputValidationError("format must be either docx or pdf");
  }

  const summaryPayload = await runEventReportTransaction((tx) =>
    getServiceSummaryPayloadTx(tx, {
      eventId,
      eventDate,
    }),
  );

  const fileBaseName = `${slugifyFilePart(summaryPayload.event_name)}-${eventDate}-service-summary`;

  if (format === "docx") {
    return {
      buffer: await generateDocxBufferFromSummary(summaryPayload),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: `${fileBaseName}.docx`,
    };
  }

  const html = await renderServiceSummaryHtml(summaryPayload);
  return {
    buffer: await generatePdfBufferFromHtml(html),
    contentType: "application/pdf",
    fileName: `${fileBaseName}.pdf`,
  };
};
