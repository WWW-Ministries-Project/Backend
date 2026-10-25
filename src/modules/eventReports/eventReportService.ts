import { promises as fs } from "fs";
import { EventReportStatus, Prisma } from "@prisma/client";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
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
import { resolve } from "path";
import {
  AppError,
  InputValidationError,
  NotFoundError,
  ResourceDuplicationError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import { prisma } from "../../Models/context";
import { getApprovalConfigByModule } from "../requisitions/requisition-approval-workflow";
import {
  canOverrideChain,
  canSignOffWithoutChain,
  hasEventReportRight,
} from "./eventReportAccess";
import {
  buildAttendanceVisitorCountsMap,
  getAttendanceVisitorCountsForRecord,
} from "../events/attendanceVisitorCounts";
import { getBranchScopedWhere } from "../branches/branchService";
import {
  AttendanceTimingResolver,
  classifyAttendanceTiming,
  loadAttendanceTimingResolver,
} from "../settings/attendanceTimingSettingsService";
import { getEventReportExcludedUserIds } from "../settings/eventReportExclusionService";
import {
  escapeHtml,
  generatePdfBufferFromHtml,
  getChurchLogoBuffer,
  getChurchLogoDataUri,
  getChurchLogoMimeType,
  slugifyFilePart,
} from "../../utils/documentRenderer";


type ApprovalWorkflowTx = Prisma.TransactionClient | typeof prisma;

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
  resolveTimingRules: AttendanceTimingResolver,
): "early" | "on_time" | "late" => {
  if (!eventStartTime) {
    return "on_time";
  }

  const minutesFromStart = Math.round(
    (arrivalTime.getTime() - eventStartTime.getTime()) / 60000,
  );

  return classifyAttendanceTiming(
    minutesFromStart,
    resolveTimingRules(arrivalTime),
  );
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
  excludedUserIds: Set<number>,
) => {
  const validDepartmentIds = Array.from(validDepartmentIdSet);
  if (!validDepartmentIds.length) {
    return new Map<number, Map<number, DepartmentMemberInfo>>();
  }

  const users = await tx.user.findMany({
    // Only load users linked to a valid department (scalar, relation, or
    // position). Without this filter the query scans the entire user table
    // inside the report transaction and times out as membership grows.
    where: {
      ...(excludedUserIds.size
        ? { id: { notIn: Array.from(excludedUserIds) } }
        : {}),
      OR: [
        { department_id: { in: validDepartmentIds } },
        { department: { department_id: { in: validDepartmentIds } } },
        {
          department_positions: {
            some: { department_id: { in: validDepartmentIds } },
          },
        },
      ],
    },
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
      branch_id: true,
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
    branchId?: number | null;
  },
) => {
  try {
    return await tx.event_reports.create({
      data: {
        event_id: args.eventId,
        event_date: toUtcDayDate(args.eventDate),
        status: EventReportStatus.PENDING_FINAL,
        created_by: args.actorUserId,
        updated_by: args.actorUserId,
        branch_id: args.branchId ?? null,
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

  if (!eventAttendanceCount && !churchAttendanceCount) {
    throw new InputValidationError(
      "This event occurrence has no attendance data yet. Record event attendance or church attendance for this date, then generate the report again.",
    );
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

  const [resolveTimingRules, excludedUserIds] = await Promise.all([
    loadAttendanceTimingResolver(tx),
    getEventReportExcludedUserIds(tx),
  ]);

  const attendanceRows = await tx.event_attendance.findMany({
    where: {
      event_id: args.eventId,
      ...(excludedUserIds.size
        ? { user_id: { notIn: Array.from(excludedUserIds) } }
        : {}),
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
    excludedUserIds,
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
            resolveTimingRules,
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
    "{{LOGO_DATA_URI}}": getChurchLogoDataUri(),
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
      ...(getChurchLogoBuffer()
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: getChurchLogoBuffer() as Buffer,
                  type:
                    getChurchLogoMimeType() === "image/png" ? "png" : "jpg",
                  transformation: {
                    width: 150,
                    height: 123, // maintain 552:452 png ratio → 150 * 452/552 ≈ 123
                  },
                }),
              ],
              spacing: { after: 80 },
            }),
          ]
        : []),
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

export const listEligibleEventReports = async (query?: { branch_id?: unknown }) => {
  const today = getTodayDateString();
  const branchWhere = getBranchScopedWhere(query?.branch_id);

  const [events, reports] = await Promise.all([
    prisma.event_mgt.findMany({
      where: {
        ...(branchWhere || {}),
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
      where: branchWhere,
      select: {
        event_id: true,
        event_date: true,
      },
    }),
  ]);

  const eventIds = events.map((event) => event.id);
  const [eventAttendanceRows, churchAttendanceRows] =
    eventIds.length > 0
      ? await Promise.all([
          prisma.event_attendance.findMany({
            where: {
              event_id: {
                in: eventIds,
              },
            },
            select: {
              event_id: true,
              created_at: true,
            },
          }),
          prisma.event_attendance_summary.findMany({
            where: {
              event_mgt_id: {
                in: eventIds,
              },
            },
            select: {
              event_mgt_id: true,
              date: true,
            },
          }),
        ])
      : [[], []];

  const existingReportKeys = new Set(
    reports.map((report) => `${report.event_id}:${toYmdDateString(report.event_date)}`),
  );
  const attendanceDataKeys = new Set<string>();

  for (const row of eventAttendanceRows) {
    attendanceDataKeys.add(`${row.event_id}:${toYmdDateString(row.created_at)}`);
  }

  for (const row of churchAttendanceRows) {
    attendanceDataKeys.add(
      `${row.event_mgt_id}:${toYmdDateString(row.date)}`,
    );
  }

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
    .filter((event) => attendanceDataKeys.has(`${event.event_id}:${event.event_date}`))
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
      branchId: event.branch_id,
    });

    await tx.event_report_activity.create({
      data: {
        event_report_id: report.id,
        action: "GENERATED",
        actor_user_id: actorUserId,
      },
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
    branch_id?: unknown;
  },
  viewer?: EventReportViewer | null,
) => {
  const eventId = toPositiveInt(query.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const eventDate = parseEventDateString(query.event_date);
  const branchWhere = getBranchScopedWhere(query.branch_id);

  // Read-only — run on the shared client, not inside a transaction.
  const detail = await buildEventReportDetailDataTx(prisma, {
    eventId,
    eventDate,
  });

  const [eventMeta, reportRow, availableReports] = await Promise.all([
    loadEventMetaTx(prisma, eventId),
    // Branch-gated like the sign-off actions: outside the caller's branches
    // the report is "not found" (the detail built above is discarded).
    findEventReportWorkflowRowTx(prisma, eventId, eventDate, query.branch_id, true),
    prisma.event_reports.findMany({
      where: {
        event_id: eventId,
        // Legacy rows without a branch stay visible, matching the actions.
        ...(branchWhere ? { OR: [branchWhere, { branch_id: null }] } : {}),
      },
      orderBy: { event_date: "desc" },
      select: { event_date: true },
    }),
  ]);

  if (!reportRow) {
    throw new NotFoundError("Event report not found");
  }

  const workflow = await buildEventReportWorkflow(reportRow, viewer ?? null);

  return {
    data: {
      ...detail,
      event_type: eventMeta?.event_type ?? null,
      start_time: eventMeta?.start_time ?? null,
      end_time: eventMeta?.end_time ?? null,
      location: eventMeta?.location ?? null,
      generated_at: reportRow.created_at.toISOString(),
      available_dates: Array.from(
        new Set(availableReports.map((row) => toYmdDateString(row.event_date))),
      ),
      ...workflow,
    },
  };
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
  branch_id?: unknown;
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
  const branchWhere = getBranchScopedWhere(query.branch_id);

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
      ...(branchWhere || {}),
      status: resolveOverviewStatusFilter(status),
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
          event_type: true,
          location: true,
          start_time: true,
          end_time: true,
          event: {
            select: {
              event_name: true,
              event_type: true,
            },
          },
        },
      },
    },
  });

  const metricsMap = await buildOverviewMetricsMap(
    prisma,
    reports.slice(0, OVERVIEW_ENRICHMENT_LIMIT).map((report) => ({
      event_id: report.event_id,
      event_date: toYmdDateString(report.event_date),
    })),
  );

  const data = reports.map((report) => {
    const eventDate = toYmdDateString(report.event_date);
    const metrics = metricsMap.get(`${report.event_id}:${eventDate}`);

    return {
      id: report.id,
      event_id: report.event_id,
      event_name: report.event?.event?.event_name || "Unknown Event",
      event_date: eventDate,
      report_status: report.status,
      status: report.status,
      generated_at: report.created_at.toISOString(),
      created_at: report.created_at.toISOString(),
      updated_at: report.updated_at.toISOString(),
      event_type: report.event?.event_type ?? report.event?.event?.event_type ?? null,
      location: report.event?.location ?? null,
      start_time: report.event?.start_time ?? null,
      end_time: report.event?.end_time ?? null,
      status_label: getEventReportStatusLabel(report.status),
      total_attendance: metrics ? metrics.total_attendance : null,
      workers_present_pct: metrics ? metrics.workers_present_pct : null,
    };
  });

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

  // Read-only path — run directly on the shared client instead of inside a
  // transaction so it does not hold a pooled connection for the whole render.
  const summaryPayload = await getServiceSummaryPayloadTx(prisma, {
    eventId,
    eventDate,
  });

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

// ---------------------------------------------------------------------------
// Report workflow: status labels, sign-off actions, trail and comments.
// ---------------------------------------------------------------------------

const OVERVIEW_ENRICHMENT_LIMIT = 300;

const PENDING_REPORT_STATUSES: EventReportStatus[] = [
  EventReportStatus.DRAFT,
  EventReportStatus.PENDING_FINAL,
];

const EVENT_REPORT_STATUS_LABELS: Record<EventReportStatus, string> = {
  [EventReportStatus.DRAFT]: "Pending approval",
  [EventReportStatus.PENDING_FINAL]: "Pending approval",
  [EventReportStatus.APPROVED]: "Approved",
  [EventReportStatus.REJECTED]: "Returned",
};

const getEventReportStatusLabel = (status: EventReportStatus): string =>
  EVENT_REPORT_STATUS_LABELS[status] || status;

/**
 * Accepts the raw enum values (older clients) plus the UI labels
 * ("pending" / "pending_approval", "returned", "approved").
 */
const resolveOverviewStatusFilter = (
  status: string | null,
): EventReportStatus | { in: EventReportStatus[] } | undefined => {
  if (!status) {
    return undefined;
  }

  const upper = status.toUpperCase();
  // New reports are created PENDING_FINAL; older clients filtering on DRAFT
  // mean "not yet signed off", so keep returning both.
  if (upper === EventReportStatus.DRAFT || upper === EventReportStatus.PENDING_FINAL) {
    return { in: PENDING_REPORT_STATUSES };
  }
  if ((Object.values(EventReportStatus) as string[]).includes(upper)) {
    return upper as EventReportStatus;
  }

  const normalized = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pending" || normalized === "pending_approval") {
    return { in: PENDING_REPORT_STATUSES };
  }
  if (normalized === "returned") {
    return EventReportStatus.REJECTED;
  }

  throw new InputValidationError("Unknown report status filter");
};

const loadEventMetaTx = (tx: ApprovalWorkflowTx, eventId: number) =>
  tx.event_mgt
    .findUnique({
      where: { id: eventId },
      select: {
        event_type: true,
        location: true,
        start_time: true,
        end_time: true,
        event: { select: { event_type: true } },
      },
    })
    .then((event) =>
      event
        ? {
            event_type: event.event_type ?? event.event?.event_type ?? null,
            location: event.location ?? null,
            start_time: event.start_time ?? null,
            end_time: event.end_time ?? null,
          }
        : null,
    );

const EVENT_REPORT_WORKFLOW_SELECT = {
  id: true,
  event_id: true,
  event_date: true,
  status: true,
  branch_id: true,
  created_by: true,
  created_at: true,
  final_acted_by_user_id: true,
  final_acted_at: true,
} as const;

type EventReportWorkflowRow = {
  id: number;
  event_id: number;
  event_date: Date;
  status: EventReportStatus;
  branch_id: number | null;
  created_by: number;
  created_at: Date;
  final_acted_by_user_id: number | null;
  final_acted_at: Date | null;
};

const findEventReportWorkflowRowTx = (
  tx: ApprovalWorkflowTx,
  eventId: number,
  eventDate: string,
  branchValue?: unknown,
  enforceBranch = false,
): Promise<EventReportWorkflowRow | null> => {
  const { start, end } = getUtcDayBounds(eventDate);
  const branchWhere = enforceBranch ? getBranchScopedWhere(branchValue) : undefined;

  return tx.event_reports.findFirst({
    where: {
      event_id: eventId,
      event_date: { gte: start, lt: end },
      // Legacy rows without a branch stay reachable from any branch.
      ...(branchWhere ? { OR: [branchWhere, { branch_id: null }] } : {}),
    },
    select: EVENT_REPORT_WORKFLOW_SELECT,
  });
};

const loadUserNamesTx = async (
  tx: ApprovalWorkflowTx,
  ids: Array<number | null | undefined>,
): Promise<Map<number, string>> => {
  const userIds = uniquePositiveIds(ids.filter((id): id is number => typeof id === "number"));
  if (!userIds.length) {
    return new Map();
  }

  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });

  return new Map(users.map((user) => [user.id, user.name]));
};

type EventReportPermissions = {
  can_approve: boolean;
  can_return: boolean;
  can_resubmit: boolean;
  can_comment: boolean;
  can_export: boolean;
};

/** The caller, with their live (active-branch) permissions from `req.access`. */
export type EventReportViewer = {
  userId: number;
  permissions: Record<string, any>;
};

type ApprovalStep = {
  order: number;
  type: string;
  position_id?: number;
  user_id?: number;
};

/** The configured event report chain (Settings › Approvals), or null when none is active. */
const loadActiveApprovalChain = async (): Promise<ApprovalStep[] | null> => {
  const config = await getApprovalConfigByModule("EVENT_REPORT" as any);
  if (!config || !config.is_active || !config.approvers?.length) return null;
  return [...config.approvers].sort((a, b) => a.order - b.order);
};

/**
 * Index of the chain step awaiting a decision: the steps approved since the
 * report was generated or last resubmitted.
 */
const currentStepIndexTx = async (tx: ApprovalWorkflowTx, reportId: number) => {
  const activity = await tx.event_report_activity.findMany({
    where: { event_report_id: reportId },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: { action: true },
  });
  let index = 0;
  for (const row of activity) {
    if (row.action === "GENERATED" || row.action === "RESUBMITTED") index = 0;
    else if (row.action === "STEP_APPROVED") index += 1;
  }
  return index;
};

/** Who may act at a step: the named person, the position's holders, or the generator's head of department. */
const stepApproverIdsTx = async (
  tx: ApprovalWorkflowTx,
  step: ApprovalStep,
  report: EventReportWorkflowRow,
): Promise<number[]> => {
  if (step.type === "SPECIFIC_PERSON") return step.user_id ? [step.user_id] : [];
  if (step.type === "POSITION") {
    if (!step.position_id) return [];
    const holders = await tx.user.findMany({
      where: { position_id: step.position_id, NOT: { is_active: false } },
      select: { id: true },
    });
    return holders.map((holder) => holder.id);
  }
  const membership = await tx.user_departments.findUnique({
    where: { user_id: report.created_by },
    select: { department_info: { select: { department_head: true } } },
  });
  const head = membership?.department_info?.department_head;
  return head ? [head] : [];
};

type SignOffDecision = {
  allowed: boolean;
  /** Steps in the configured chain (0 = no chain). */
  totalSteps: number;
  stepIndex: number;
};

/**
 * Whether the viewer may approve or return the report now. With a chain
 * configured, only the current step's approver (or Full on Reports, as an
 * override) may act; without one, Full on Reports or an on-purpose
 * `event_approve`. Nobody approves a report they generated themselves.
 */
const decideSignOffTx = async (
  tx: ApprovalWorkflowTx,
  viewer: EventReportViewer,
  report: EventReportWorkflowRow,
  intent: "approve" | "return",
): Promise<SignOffDecision> => {
  const chain = await loadActiveApprovalChain();
  const stepIndex = chain ? await currentStepIndexTx(tx, report.id) : 0;
  const totalSteps = chain?.length ?? 0;
  const deny = { allowed: false, totalSteps, stepIndex };

  if (intent === "approve" && report.created_by === viewer.userId) return deny;
  if (!chain) {
    return { ...deny, allowed: canSignOffWithoutChain(viewer.permissions) };
  }
  if (canOverrideChain(viewer.permissions)) return { ...deny, allowed: true };
  if ((viewer.permissions as any)?.Actions?.Reports?.event_approve === false) return deny;
  const step = chain[Math.min(stepIndex, chain.length - 1)];
  const approvers = await stepApproverIdsTx(tx, step, report);
  return { ...deny, allowed: approvers.includes(viewer.userId) };
};

const computeEventReportPermissions = async (
  viewer: EventReportViewer | null,
  report: EventReportWorkflowRow,
): Promise<EventReportPermissions> => {
  if (!viewer) {
    return {
      can_approve: false,
      can_return: false,
      can_resubmit: false,
      can_comment: false,
      can_export: false,
    };
  }

  const isPending = PENDING_REPORT_STATUSES.includes(report.status);
  const [approve, ret, generate, comment, exportReport] = await Promise.all([
    isPending ? decideSignOffTx(prisma, viewer, report, "approve") : null,
    isPending ? decideSignOffTx(prisma, viewer, report, "return") : null,
    hasEventReportRight(viewer.userId, viewer.permissions, "generate"),
    hasEventReportRight(viewer.userId, viewer.permissions, "comment"),
    hasEventReportRight(viewer.userId, viewer.permissions, "export"),
  ]);

  return {
    can_approve: Boolean(approve?.allowed),
    can_return: Boolean(ret?.allowed),
    can_resubmit: report.status === EventReportStatus.REJECTED && generate,
    can_comment: comment,
    can_export: exportReport,
  };
};

const buildEventReportWorkflow = async (
  report: EventReportWorkflowRow,
  viewer: EventReportViewer | null,
) => {
  const [activity, comments, permissions] = await Promise.all([
    prisma.event_report_activity.findMany({
      where: { event_report_id: report.id },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select: { action: true, actor_user_id: true, note: true, created_at: true },
    }),
    prisma.event_report_comments.findMany({
      where: { event_report_id: report.id },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      select: { id: true, author_user_id: true, body: true, created_at: true },
    }),
    computeEventReportPermissions(viewer, report),
  ]);

  const names = await loadUserNamesTx(prisma, [
    report.created_by,
    report.final_acted_by_user_id,
    ...activity.map((row) => row.actor_user_id),
    ...comments.map((row) => row.author_user_id),
  ]);
  const nameOf = (id: number | null | undefined) =>
    id ? names.get(id) ?? null : null;

  const trail = activity.map((row) => ({
    action: row.action,
    who: nameOf(row.actor_user_id),
    when: row.created_at.toISOString(),
    note: row.note ?? null,
  }));

  // Reports generated before the activity log existed: synthesize the entry.
  if (!activity.some((row) => row.action === "GENERATED")) {
    trail.unshift({
      action: "GENERATED",
      who: nameOf(report.created_by),
      when: report.created_at.toISOString(),
      note: null,
    });
  }

  return {
    report: {
      id: report.id,
      status: report.status,
      status_label: getEventReportStatusLabel(report.status),
      generated_at: report.created_at.toISOString(),
      generated_by_name: nameOf(report.created_by),
      acted_at: report.final_acted_at ? report.final_acted_at.toISOString() : null,
      acted_by_name: nameOf(report.final_acted_by_user_id),
    },
    trail,
    comments: comments.map((row) => ({
      id: row.id,
      author: nameOf(row.author_user_id),
      when: row.created_at.toISOString(),
      text: row.body,
    })),
    permissions,
  };
};

/**
 * Overview metrics for many reports at once: church attendance total (incl.
 * visitors) and workers-present %, matching the detail endpoint's
 * church_attendance.total_attendance and department_summary.attendance_percentage.
 */
const buildOverviewMetricsMap = async (
  tx: ApprovalWorkflowTx,
  rows: Array<{ event_id: number; event_date: string }>,
) => {
  const result = new Map<
    string,
    { total_attendance: number; workers_present_pct: number }
  >();
  if (!rows.length) {
    return result;
  }

  const keyOf = (eventId: number, date: string) => `${eventId}:${date}`;
  const wantedKeys = new Set(rows.map((row) => keyOf(row.event_id, row.event_date)));
  const eventIds = uniquePositiveIds(rows.map((row) => row.event_id));
  const sortedDates = rows.map((row) => row.event_date).sort();
  const rangeStart = toUtcDayDate(sortedDates[0]);
  const rangeEnd = getUtcDayBounds(sortedDates[sortedDates.length - 1]).end;

  const [summaries, excludedUserIds, departments] = await Promise.all([
    tx.event_attendance_summary.findMany({
      where: {
        event_mgt_id: { in: eventIds },
        date: { gte: rangeStart, lt: rangeEnd },
      },
      orderBy: { date: "desc" },
      select: {
        event_mgt_id: true,
        date: true,
        adultMale: true,
        adultFemale: true,
        childrenMale: true,
        childrenFemale: true,
        youthMale: true,
        youthFemale: true,
      },
    }),
    getEventReportExcludedUserIds(tx),
    tx.department.findMany({ select: { id: true } }),
  ]);

  // Same pick as the detail endpoint: the latest summary of the day.
  const summaryByKey = new Map<string, (typeof summaries)[number]>();
  for (const summary of summaries) {
    const key = keyOf(summary.event_mgt_id, toYmdDateString(summary.date));
    if (wantedKeys.has(key) && !summaryByKey.has(key)) {
      summaryByKey.set(key, summary);
    }
  }

  const visitorLookups = rows.map((row) => ({
    eventId: row.event_id,
    date:
      summaryByKey.get(keyOf(row.event_id, row.event_date))?.date ||
      toUtcDayDate(row.event_date),
  }));

  const [visitorCountsByKey, membersByDepartment, attendanceRows] = await Promise.all([
    buildAttendanceVisitorCountsMap(visitorLookups, tx),
    getDepartmentMembersByDepartmentTx(
      tx,
      new Set(departments.map((department) => department.id)),
      excludedUserIds,
    ),
    tx.event_attendance.findMany({
      where: {
        event_id: { in: eventIds },
        ...(excludedUserIds.size
          ? { user_id: { notIn: Array.from(excludedUserIds) } }
          : {}),
        created_at: { gte: rangeStart, lt: rangeEnd },
      },
      select: { event_id: true, user_id: true, created_at: true },
    }),
  ]);

  // A worker counts once per department they belong to, like the detail view.
  const departmentCountByUser = new Map<number, number>();
  let totalMembers = 0;
  for (const members of membersByDepartment.values()) {
    totalMembers += members.size;
    for (const userId of members.keys()) {
      departmentCountByUser.set(userId, (departmentCountByUser.get(userId) || 0) + 1);
    }
  }

  const attendeesByKey = new Map<string, Set<number>>();
  for (const row of attendanceRows) {
    const key = keyOf(row.event_id, toYmdDateString(row.created_at));
    if (!wantedKeys.has(key)) {
      continue;
    }
    const bucket = attendeesByKey.get(key) || new Set<number>();
    bucket.add(row.user_id);
    attendeesByKey.set(key, bucket);
  }

  for (const [index, row] of rows.entries()) {
    const key = keyOf(row.event_id, row.event_date);
    const summary = summaryByKey.get(key);
    const visitorCounts = getAttendanceVisitorCountsForRecord(
      visitorCountsByKey,
      row.event_id,
      visitorLookups[index].date,
    );

    let presentMembers = 0;
    for (const userId of attendeesByKey.get(key) || []) {
      presentMembers += departmentCountByUser.get(userId) || 0;
    }

    result.set(key, {
      total_attendance:
        Number(summary?.adultMale || 0) +
        Number(summary?.adultFemale || 0) +
        Number(summary?.childrenMale || 0) +
        Number(summary?.childrenFemale || 0) +
        Number(summary?.youthMale || 0) +
        Number(summary?.youthFemale || 0) +
        visitorCounts.total.total,
      workers_present_pct:
        totalMembers > 0
          ? Number(((presentMembers / totalMembers) * 100).toFixed(1))
          : 0,
    });
  }

  return result;
};

type EventReportActionPayload = {
  event_id?: unknown;
  event_date?: unknown;
  branch_id?: unknown;
  note?: unknown;
  text?: unknown;
};

const parseActionTarget = (payload: EventReportActionPayload, user: any) => {
  const eventId = toPositiveInt(payload?.event_id);
  if (!eventId) {
    throw new InputValidationError("event_id must be a positive integer");
  }

  const actorUserId = toPositiveInt(user?.id);
  if (!actorUserId) {
    throw new InputValidationError("Authenticated user not found");
  }

  return {
    eventId,
    eventDate: parseEventDateString(payload?.event_date),
    actorUserId,
  };
};

const loadActionReportTx = async (
  tx: ApprovalWorkflowTx,
  eventId: number,
  eventDate: string,
  branchValue: unknown,
) => {
  const report = await findEventReportWorkflowRowTx(
    tx,
    eventId,
    eventDate,
    branchValue,
    true,
  );
  if (!report) {
    throw new NotFoundError("Event report not found");
  }
  return report;
};

/**
 * Moves a report between statuses only if it is still in one of `from`, so two
 * people acting at once cannot both win.
 */
const transitionEventReportTx = async (
  tx: ApprovalWorkflowTx,
  args: {
    report: EventReportWorkflowRow;
    from: EventReportStatus[];
    to: EventReportStatus;
    actorUserId: number;
    finalActed: "set" | "clear";
    conflictMessage: string;
  },
) => {
  const now = new Date();
  const updated = await tx.event_reports.updateMany({
    where: { id: args.report.id, status: { in: args.from } },
    data: {
      status: args.to,
      updated_by: args.actorUserId,
      final_acted_by_user_id: args.finalActed === "set" ? args.actorUserId : null,
      final_acted_at: args.finalActed === "set" ? now : null,
    },
  });

  if (!updated.count) {
    throw new AppError(args.conflictMessage, 409);
  }
};

const assertCanSignOffTx = async (
  tx: ApprovalWorkflowTx,
  viewer: EventReportViewer,
  report: EventReportWorkflowRow,
  intent: "approve" | "return",
) => {
  const decision = await decideSignOffTx(tx, viewer, report, intent);
  if (!decision.allowed) {
    throw new AppError(
      intent === "approve" && report.created_by === viewer.userId
        ? "You generated this report, so someone else must approve it"
        : "Not authorized to sign off this event report",
      403,
    );
  }
  return decision;
};

const respondWithWorkflow = async (
  eventId: number,
  eventDate: string,
  viewer: EventReportViewer,
) => {
  const report = await findEventReportWorkflowRowTx(prisma, eventId, eventDate);
  if (!report) {
    throw new NotFoundError("Event report not found");
  }
  return {
    data: {
      event_id: eventId,
      event_date: eventDate,
      ...(await buildEventReportWorkflow(report, viewer)),
    },
  };
};

export const approveEventReport = async (
  payload: EventReportActionPayload,
  viewer: EventReportViewer,
) => {
  const { eventId, eventDate, actorUserId } = parseActionTarget(payload, { id: viewer.userId });

  await runEventReportTransaction(async (tx) => {
    const report = await loadActionReportTx(tx, eventId, eventDate, payload?.branch_id);
    if (!PENDING_REPORT_STATUSES.includes(report.status)) {
      throw new AppError("This report is not awaiting approval", 409);
    }
    const decision = await assertCanSignOffTx(tx, viewer, report, "approve");
    const finalStep = decision.totalSteps === 0 || decision.stepIndex >= decision.totalSteps - 1;

    if (!finalStep) {
      // An earlier step of the chain: record it and wait for the next approver.
      await tx.event_report_activity.create({
        data: {
          event_report_id: report.id,
          action: "STEP_APPROVED",
          actor_user_id: actorUserId,
          note: `Step ${decision.stepIndex + 1} of ${decision.totalSteps}`,
        },
      });
      return;
    }

    await transitionEventReportTx(tx, {
      report,
      from: PENDING_REPORT_STATUSES,
      to: EventReportStatus.APPROVED,
      actorUserId,
      finalActed: "set",
      conflictMessage: "This report is not awaiting approval",
    });
    await tx.event_report_activity.create({
      data: {
        event_report_id: report.id,
        action: "APPROVED",
        actor_user_id: actorUserId,
      },
    });
  });

  return respondWithWorkflow(eventId, eventDate, viewer);
};

export const returnEventReport = async (
  payload: EventReportActionPayload,
  viewer: EventReportViewer,
) => {
  const { eventId, eventDate, actorUserId } = parseActionTarget(payload, { id: viewer.userId });
  const note = typeof payload?.note === "string" ? payload.note.trim() : "";
  if (!note) {
    throw new InputValidationError("A note is required when returning a report");
  }

  await runEventReportTransaction(async (tx) => {
    const report = await loadActionReportTx(tx, eventId, eventDate, payload?.branch_id);
    if (!PENDING_REPORT_STATUSES.includes(report.status)) {
      throw new AppError("This report is not awaiting approval", 409);
    }
    await assertCanSignOffTx(tx, viewer, report, "return");
    await transitionEventReportTx(tx, {
      report,
      from: PENDING_REPORT_STATUSES,
      to: EventReportStatus.REJECTED,
      actorUserId,
      finalActed: "set",
      conflictMessage: "This report is not awaiting approval",
    });
    await tx.event_report_activity.create({
      data: {
        event_report_id: report.id,
        action: "RETURNED",
        actor_user_id: actorUserId,
        note,
      },
    });
    await tx.event_report_comments.create({
      data: {
        event_report_id: report.id,
        author_user_id: actorUserId,
        body: note,
      },
    });
  });

  return respondWithWorkflow(eventId, eventDate, viewer);
};

export const resubmitEventReport = async (
  payload: EventReportActionPayload,
  viewer: EventReportViewer,
) => {
  const { eventId, eventDate, actorUserId } = parseActionTarget(payload, { id: viewer.userId });

  await runEventReportTransaction(async (tx) => {
    const report = await loadActionReportTx(tx, eventId, eventDate, payload?.branch_id);
    await transitionEventReportTx(tx, {
      report,
      from: [EventReportStatus.REJECTED],
      to: EventReportStatus.PENDING_FINAL,
      actorUserId,
      finalActed: "clear",
      conflictMessage: "Only returned reports can be resubmitted",
    });
    await tx.event_report_activity.create({
      data: {
        event_report_id: report.id,
        action: "RESUBMITTED",
        actor_user_id: actorUserId,
      },
    });
  });

  return respondWithWorkflow(eventId, eventDate, viewer);
};

export const commentOnEventReport = async (
  payload: EventReportActionPayload,
  user: any,
) => {
  const { eventId, eventDate, actorUserId } = parseActionTarget(payload, user);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new InputValidationError("Comment text is required");
  }

  const report = await loadActionReportTx(prisma, eventId, eventDate, payload?.branch_id);
  const comment = await prisma.event_report_comments.create({
    data: {
      event_report_id: report.id,
      author_user_id: actorUserId,
      body: text,
    },
    select: { id: true, author_user_id: true, body: true, created_at: true },
  });
  const names = await loadUserNamesTx(prisma, [comment.author_user_id]);

  return {
    data: {
      id: comment.id,
      author: names.get(comment.author_user_id) ?? null,
      when: comment.created_at.toISOString(),
      text: comment.body,
    },
  };
};
