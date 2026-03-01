import {
  RequestApprovalStatus,
  RequisitionApprovalInstanceStatus,
  appointment_status,
} from "@prisma/client";
import { prisma } from "../../Models/context";
import { AiContext } from "./aiTypes";

type MemberMetrics = {
  source: string;
  total_members: number;
  online_members: number;
  inhouse_members: number;
  male_members: number;
  female_members: number;
  other_members: number;
};

type AttendanceTodayMetrics = {
  source: string;
  date: string;
  day_basis: string;
  window_start: string;
  window_end: string;
  records: number;
  male_total: number;
  female_total: number;
  adult_male: number;
  youth_male: number;
  children_male: number;
  adult_female: number;
  youth_female: number;
  children_female: number;
  visitors: number;
  new_members: number;
  visiting_pastors: number;
};

type MetricBundle = {
  members?: MemberMetrics;
  attendance_today?: AttendanceTodayMetrics;
};

type ActiveProgramRecord = {
  program_id: number;
  title: string;
  cohort_id: number | null;
  cohort_name: string | null;
  cohort_status: string | null;
  cohort_start_date: string | null;
  prerequisite_count: number;
};

type ProgramPrerequisiteMatch = {
  program_id: number;
  title: string;
  prerequisites: Array<{ program_id: number; title: string }>;
  active_cohorts: Array<{
    cohort_id: number;
    name: string;
    status: string;
    start_date: string;
  }>;
};

type PendingRequestRecord = {
  request_db_id: number;
  request_id: string;
  status: string;
  requester_name: string;
  department_name: string;
  requisition_date: string;
  total_amount: number;
};

type AssignedPendingRecord = {
  approval_instance_id: number;
  request_db_id: number;
  request_id: string;
  step_order: number;
  request_status: string;
  requester_name: string;
  department_name: string;
  requisition_date: string;
};

type AttendanceLookupRecord = {
  attendance_summary_id: number;
  event_id: number;
  event_name: string | null;
  event_start_date: string | null;
  attendance_date: string;
  group: string;
  male_total: number;
  female_total: number;
  attendance_total: number;
  visitors: number;
  new_members: number;
  visiting_pastors: number;
  attendance_plus_visitors: number;
};

type AttendanceLookupTotals = {
  male_total: number;
  female_total: number;
  attendance_total: number;
  visitors: number;
  new_members: number;
  visiting_pastors: number;
  attendance_plus_visitors: number;
};

type DbKnowledge = {
  generated_at: string;
  intents: string[];
  entity_hints: string[];
  lookup_hits?: {
    data_source: string;
    query: string;
    programs: Array<{ id: number; title: string }>;
    cohorts: Array<{ id: number; name: string; status: string; program_title: string }>;
    users: Array<{ id: number; name: string; membership_type: string | null }>;
    requests: Array<{ id: number; request_id: string; status: string }>;
    events: Array<{ id: number; event_name: string | null; start_date: string | null }>;
    products: Array<{ id: number; name: string; status: string | null }>;
  };
  active_programs?: {
    data_source: string;
    total_matching: number;
    current_active_program: ActiveProgramRecord | null;
    items: ActiveProgramRecord[];
  };
  program_prerequisites?: {
    data_source: string;
    requested_program: string;
    matched_count: number;
    matches: ProgramPrerequisiteMatch[];
  };
  pending_approvals?: {
    data_source: string;
    overall_pending_count: number;
    awaiting_hod_count: number;
    awaiting_exec_pastor_count: number;
    latest_pending_requests: PendingRequestRecord[];
    actor_pending_count?: number;
    actor_pending_requests?: AssignedPendingRecord[];
  };
  operational_snapshot?: {
    data_source: string;
    date_basis: string;
    date: string;
    total_members: number;
    active_programs: number;
    pending_requisitions: number;
    upcoming_events: number;
    pending_appointments_today: number;
    visitors_today: number;
  };
  attendance_lookup?: {
    data_source: string;
    date_basis: string;
    requested_date: string | null;
    requested_event_name: string | null;
    matched_records: number;
    matched_events: Array<{ event_id: number; event_name: string | null }>;
    totals: AttendanceLookupTotals;
    records: AttendanceLookupRecord[];
    notes: string[];
  };
};

const MEMBERSHIP_TYPES = ["ONLINE", "IN_HOUSE"] as const;
const ACTIVE_COHORT_STATUSES = ["Ongoing", "Upcoming"] as const;
const PENDING_REQUISITION_STATUSES = [
  RequestApprovalStatus.Awaiting_HOD_Approval,
  RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
] as const;

const MAX_LIST_ITEMS = 5;

export class AiBusinessContextService {
  async enrichContext(
    message: string,
    context: AiContext,
    actorId?: number,
  ): Promise<AiContext> {
    const normalizedModule = this.normalizeModuleName(context.module);
    const safeMessage = String(message || "");

    // Always include baseline member metrics. Keep other enrichments lightweight.
    const includeMemberMetrics = true;
    const includeAttendanceToday = this.matchesAny(safeMessage, ATTENDANCE_INTENT_PATTERNS);

    const warnings: string[] = [];
    const metrics: MetricBundle = {};

    const metricTasks: Array<Promise<void>> = [];

    if (includeMemberMetrics) {
      metricTasks.push(
        this.getMemberMetrics()
          .then((snapshot) => {
            metrics.members = snapshot;
          })
          .catch(() => {
            warnings.push("members_metrics_unavailable");
          }),
      );
    }

    if (includeAttendanceToday) {
      metricTasks.push(
        this.getAttendanceTodayMetrics()
          .then((snapshot) => {
            metrics.attendance_today = snapshot;
          })
          .catch(() => {
            warnings.push("attendance_today_metrics_unavailable");
          }),
      );
    }

    const knowledgePromise = this.buildKnowledge(safeMessage).catch(() => {
      warnings.push("db_knowledge_unavailable");
      return null;
    });

    const [, knowledge] = await Promise.all([Promise.all(metricTasks), knowledgePromise]);

    return {
      ...context,
      module: normalizedModule || (typeof context.module === "string" ? context.module : undefined),
      cross_module_access: true,
      ai_business: {
        generated_at: new Date().toISOString(),
        module_policy: "always_cross_module",
        cross_module_access: true,
        canonical_metrics: {
          total_members:
            "Count of members from user_info linked to user where membership_type is ONLINE or IN_HOUSE.",
          male_attendance_today:
            "Sum of event_attendance_summary.adultMale + youthMale + childrenMale for today's records.",
          attendance_total:
            "adultMale + youthMale + childrenMale + adultFemale + youthFemale + childrenFemale.",
          attendance_plus_visitors:
            "attendance_total + visitors for the same attendance summary record.",
          current_active_program:
            "Program where completed=false and at least one cohort has status Ongoing or Upcoming.",
          pending_requisitions:
            "Request records where request_approval_status is Awaiting_HOD_Approval or Awaiting_Executive_Pastor_Approval.",
        },
        metrics,
        knowledge,
        warnings,
      },
    };
  }

  private async buildKnowledge(
    message: string,
  ): Promise<DbKnowledge | null> {
    const intents = this.detectIntents(message);
    const entityHints = this.detectEntityHints(message);

    // Keep prefetch lightweight. The model can fetch detailed data on demand via tools.
    const shouldLoadActivePrograms = false;
    const shouldLoadProgramPrerequisites = false;
    const shouldLoadPendingApprovals = false;
    const shouldLoadAttendanceLookup =
      intents.has("attendance_lookup") ||
      entityHints.has("attendance") ||
      this.hasDateLikeToken(message);

    const shouldLoadLookupHits = false;
    const shouldLoadOperationalSnapshot = true;

    const knowledge: DbKnowledge = {
      generated_at: new Date().toISOString(),
      intents: Array.from(intents),
      entity_hints: Array.from(entityHints),
    };

    const tasks: Array<Promise<void>> = [];

    if (shouldLoadActivePrograms) {
      tasks.push(
        this.getActiveProgramsKnowledge().then((payload) => {
          knowledge.active_programs = payload;
        }),
      );
    }

    if (shouldLoadLookupHits) {
      tasks.push(
        this.getLookupHitsKnowledge(message).then((payload) => {
          knowledge.lookup_hits = payload;
        }),
      );
    }

    const programNameCandidate = this.extractProgramNameForPrerequisiteLookup(message);
    if (shouldLoadProgramPrerequisites && programNameCandidate) {
      tasks.push(
        this.getProgramPrerequisitesKnowledge(programNameCandidate).then((payload) => {
          knowledge.program_prerequisites = payload;
        }),
      );
    }

    if (shouldLoadPendingApprovals) {
      tasks.push(
        this.getPendingApprovalsKnowledge().then((payload) => {
          knowledge.pending_approvals = payload;
        }),
      );
    }

    if (shouldLoadOperationalSnapshot) {
      tasks.push(
        this.getOperationalSnapshotKnowledge().then((payload) => {
          knowledge.operational_snapshot = payload;
        }),
      );
    }

    if (shouldLoadAttendanceLookup) {
      tasks.push(
        this.getAttendanceLookupKnowledge(message).then((payload) => {
          knowledge.attendance_lookup = payload;
        }),
      );
    }

    if (!tasks.length) {
      return null;
    }

    await Promise.allSettled(tasks);
    return knowledge;
  }

  private async getActiveProgramsKnowledge(): Promise<DbKnowledge["active_programs"]> {
    const records = await prisma.program.findMany({
      where: {
        completed: false,
        cohorts: {
          some: {
            status: { in: [...ACTIVE_COHORT_STATUSES] },
          },
        },
      },
      include: {
        prerequisitePrograms: {
          select: {
            prerequisiteId: true,
          },
        },
        cohorts: {
          where: {
            status: { in: [...ACTIVE_COHORT_STATUSES] },
          },
          select: {
            id: true,
            name: true,
            status: true,
            startDate: true,
          },
          orderBy: {
            startDate: "asc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 20,
    });

    const items: ActiveProgramRecord[] = records.map((record) => {
      const selectedCohort =
        record.cohorts.find((cohort) => cohort.status === "Ongoing") ||
        record.cohorts.find((cohort) => cohort.status === "Upcoming") ||
        null;

      return {
        program_id: record.id,
        title: record.title,
        cohort_id: selectedCohort?.id || null,
        cohort_name: selectedCohort?.name || null,
        cohort_status: selectedCohort?.status || null,
        cohort_start_date: selectedCohort?.startDate
          ? selectedCohort.startDate.toISOString()
          : null,
        prerequisite_count: record.prerequisitePrograms.length,
      };
    });

    const current =
      items.find((item) => item.cohort_status === "Ongoing") ||
      items.find((item) => item.cohort_status === "Upcoming") ||
      null;

    return {
      data_source: "prisma.program + cohort + program_prerequisites",
      total_matching: items.length,
      current_active_program: current,
      items: items.slice(0, MAX_LIST_ITEMS),
    };
  }

  private async getLookupHitsKnowledge(message: string): Promise<DbKnowledge["lookup_hits"]> {
    const searchPhrase = this.extractLookupPhrase(message);

    if (!searchPhrase) {
      return {
        data_source:
          "prisma.program + cohort + user + request + event_mgt + products (db-first precheck)",
        query: "",
        programs: [],
        cohorts: [],
        users: [],
        requests: [],
        events: [],
        products: [],
      };
    }

    const [programs, cohorts, users, requests, events, products] = await Promise.all([
      prisma.program.findMany({
        where: {
          title: {
            contains: searchPhrase,
          },
        },
        select: {
          id: true,
          title: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 3,
      }),
      prisma.cohort.findMany({
        where: {
          name: {
            contains: searchPhrase,
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
          program: {
            select: {
              title: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 3,
      }),
      prisma.user.findMany({
        where: {
          name: {
            contains: searchPhrase,
          },
        },
        select: {
          id: true,
          name: true,
          membership_type: true,
        },
        orderBy: {
          created_at: "desc",
        },
        take: 3,
      }),
      prisma.request.findMany({
        where: {
          OR: [
            {
              request_id: {
                contains: searchPhrase,
              },
            },
            {
              user: {
                name: {
                  contains: searchPhrase,
                },
              },
            },
          ],
        },
        select: {
          id: true,
          request_id: true,
          request_approval_status: true,
        },
        orderBy: {
          requisition_date: "desc",
        },
        take: 3,
      }),
      prisma.event_mgt.findMany({
        where: {
          event: {
            event_name: {
              contains: searchPhrase,
            },
          },
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
        orderBy: {
          created_at: "desc",
        },
        take: 3,
      }),
      prisma.products.findMany({
        where: {
          name: {
            contains: searchPhrase,
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
        orderBy: {
          updated_at: "desc",
        },
        take: 3,
      }),
    ]);

    return {
      data_source:
        "prisma.program + cohort + user + request + event_mgt + products (db-first precheck)",
      query: searchPhrase,
      programs,
      cohorts: cohorts.map((cohort) => ({
        id: cohort.id,
        name: cohort.name,
        status: cohort.status,
        program_title: cohort.program.title,
      })),
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        membership_type: user.membership_type || null,
      })),
      requests: requests.map((request) => ({
        id: request.id,
        request_id: request.request_id,
        status: request.request_approval_status,
      })),
      events: events.map((event) => ({
        id: event.id,
        event_name: event.event.event_name,
        start_date: event.start_date ? event.start_date.toISOString() : null,
      })),
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        status: product.status || null,
      })),
    };
  }

  private async getAttendanceLookupKnowledge(
    message: string,
  ): Promise<DbKnowledge["attendance_lookup"]> {
    const requestedDate = this.extractDateForAttendanceLookup(message);
    let requestedEventName = this.extractEventNameForAttendanceLookup(message);
    const notes: string[] = [];
    const where: any = {};

    if (requestedDate) {
      const { startOfDay, endOfDay } = this.getDayBounds(requestedDate);
      where.date = {
        gte: startOfDay,
        lt: endOfDay,
      };
    }

    if (requestedEventName) {
      where.event = {
        event: {
          event_name: {
            contains: requestedEventName,
          },
        },
      };
    }

    let rows = await prisma.event_attendance_summary.findMany({
      where,
      include: {
        event: {
          select: {
            id: true,
            start_date: true,
            event: {
              select: {
                event_name: true,
              },
            },
          },
        },
      },
      orderBy: [{ date: "desc" }, { event_mgt_id: "asc" }],
      take: 30,
    });

    if (!rows.length && requestedEventName) {
      const relaxedEventName = requestedEventName
        .replace(/\b(19|20)\d{2}\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (relaxedEventName && relaxedEventName !== requestedEventName) {
        const relaxedWhere = {
          ...where,
          event: {
            event: {
              event_name: {
                contains: relaxedEventName,
              },
            },
          },
        };

        const relaxedRows = await prisma.event_attendance_summary.findMany({
          where: relaxedWhere,
          include: {
            event: {
              select: {
                id: true,
                start_date: true,
                event: {
                  select: {
                    event_name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ date: "desc" }, { event_mgt_id: "asc" }],
          take: 30,
        });

        if (relaxedRows.length > 0) {
          rows = relaxedRows;
          requestedEventName = relaxedEventName;
          notes.push("attendance_lookup_event_query_relaxed");
        }
      }
    }

    const records: AttendanceLookupRecord[] = rows.map((row) => {
      const maleTotal =
        Number(row.adultMale || 0) +
        Number(row.youthMale || 0) +
        Number(row.childrenMale || 0);
      const femaleTotal =
        Number(row.adultFemale || 0) +
        Number(row.youthFemale || 0) +
        Number(row.childrenFemale || 0);
      const attendanceTotal = maleTotal + femaleTotal;
      const visitors = Number(row.visitors || 0);
      const newMembers = Number(row.newMembers || 0);
      const visitingPastors = Number(row.visitingPastors || 0);

      return {
        attendance_summary_id: row.id,
        event_id: row.event_mgt_id,
        event_name: row.event.event.event_name,
        event_start_date: row.event.start_date
          ? row.event.start_date.toISOString()
          : null,
        attendance_date: row.date.toISOString().slice(0, 10),
        group: String(row.group || "BOTH"),
        male_total: maleTotal,
        female_total: femaleTotal,
        attendance_total: attendanceTotal,
        visitors,
        new_members: newMembers,
        visiting_pastors: visitingPastors,
        attendance_plus_visitors: attendanceTotal + visitors,
      };
    });

    const totals: AttendanceLookupTotals = {
      male_total: 0,
      female_total: 0,
      attendance_total: 0,
      visitors: 0,
      new_members: 0,
      visiting_pastors: 0,
      attendance_plus_visitors: 0,
    };

    const matchedEventsMap = new Map<number, { event_id: number; event_name: string | null }>();

    for (const record of records) {
      totals.male_total += record.male_total;
      totals.female_total += record.female_total;
      totals.attendance_total += record.attendance_total;
      totals.visitors += record.visitors;
      totals.new_members += record.new_members;
      totals.visiting_pastors += record.visiting_pastors;
      totals.attendance_plus_visitors += record.attendance_plus_visitors;

      if (!matchedEventsMap.has(record.event_id)) {
        matchedEventsMap.set(record.event_id, {
          event_id: record.event_id,
          event_name: record.event_name,
        });
      }
    }

    if (!records.length) {
      notes.push("no_attendance_records_found_for_filters");
    }

    return {
      data_source: "prisma.event_attendance_summary + event_mgt + event_act",
      date_basis: "server_local_time",
      requested_date: requestedDate ? requestedDate.toISOString().slice(0, 10) : null,
      requested_event_name: requestedEventName || null,
      matched_records: records.length,
      matched_events: Array.from(matchedEventsMap.values()),
      totals,
      records,
      notes,
    };
  }

  private async getProgramPrerequisitesKnowledge(
    requestedProgram: string,
  ): Promise<DbKnowledge["program_prerequisites"]> {
    const normalizedRequested = this.cleanProgramName(requestedProgram);
    const directMatches = await prisma.program.findMany({
      where: {
        title: {
          contains: normalizedRequested,
        },
      },
      include: {
        prerequisitePrograms: {
          select: {
            prerequisite: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        cohorts: {
          where: {
            status: { in: [...ACTIVE_COHORT_STATUSES] },
          },
          select: {
            id: true,
            name: true,
            status: true,
            startDate: true,
          },
          orderBy: {
            startDate: "asc",
          },
          take: MAX_LIST_ITEMS,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: MAX_LIST_ITEMS,
    });

    const matches: ProgramPrerequisiteMatch[] = directMatches.map((program) => ({
      program_id: program.id,
      title: program.title,
      prerequisites: program.prerequisitePrograms.map((entry) => ({
        program_id: entry.prerequisite.id,
        title: entry.prerequisite.title,
      })),
      active_cohorts: program.cohorts.map((cohort) => ({
        cohort_id: cohort.id,
        name: cohort.name,
        status: cohort.status,
        start_date: cohort.startDate.toISOString(),
      })),
    }));

    return {
      data_source: "prisma.program + program_prerequisites + cohort",
      requested_program: normalizedRequested,
      matched_count: matches.length,
      matches,
    };
  }

  private async getPendingApprovalsKnowledge(
    actorId?: number,
  ): Promise<DbKnowledge["pending_approvals"]> {
    const [overallPendingCount, groupedStatusCounts, latestPendingRequests] = await Promise.all([
      prisma.request.count({
        where: {
          request_approval_status: {
            in: [...PENDING_REQUISITION_STATUSES],
          },
        },
      }),
      prisma.request.groupBy({
        by: ["request_approval_status"],
        where: {
          request_approval_status: {
            in: [...PENDING_REQUISITION_STATUSES],
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.request.findMany({
        where: {
          request_approval_status: {
            in: [...PENDING_REQUISITION_STATUSES],
          },
        },
        select: {
          id: true,
          request_id: true,
          request_approval_status: true,
          requisition_date: true,
          user: {
            select: {
              name: true,
            },
          },
          department: {
            select: {
              name: true,
            },
          },
          products: {
            select: {
              unitPrice: true,
              quantity: true,
            },
          },
        },
        orderBy: {
          requisition_date: "desc",
        },
        take: MAX_LIST_ITEMS,
      }),
    ]);

    const awaitingHodCount =
      groupedStatusCounts.find(
        (item) => item.request_approval_status === RequestApprovalStatus.Awaiting_HOD_Approval,
      )?._count._all || 0;
    const awaitingExecPastorCount =
      groupedStatusCounts.find(
        (item) =>
          item.request_approval_status ===
          RequestApprovalStatus.Awaiting_Executive_Pastor_Approval,
      )?._count._all || 0;

    const latestPending: PendingRequestRecord[] = latestPendingRequests.map((request) => ({
      request_db_id: request.id,
      request_id: request.request_id,
      status: request.request_approval_status,
      requester_name: request.user?.name || "Unknown",
      department_name: request.department?.name || "Unknown",
      requisition_date: request.requisition_date.toISOString(),
      total_amount: request.products.reduce(
        (sum, product) => sum + Number(product.unitPrice) * Number(product.quantity),
        0,
      ),
    }));

    let actorPendingCount: number | undefined;
    let actorPendingRequests: AssignedPendingRecord[] | undefined;

    if (Number.isInteger(actorId) && Number(actorId) > 0) {
      try {
        const [count, assignedRows] = await Promise.all([
          prisma.requisition_approval_instances.count({
            where: {
              approver_user_id: Number(actorId),
              status: RequisitionApprovalInstanceStatus.PENDING,
            },
          }),
          prisma.requisition_approval_instances.findMany({
            where: {
              approver_user_id: Number(actorId),
              status: RequisitionApprovalInstanceStatus.PENDING,
            },
            select: {
              id: true,
              step_order: true,
              request: {
                select: {
                  id: true,
                  request_id: true,
                  request_approval_status: true,
                  requisition_date: true,
                  user: {
                    select: {
                      name: true,
                    },
                  },
                  department: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              created_at: "desc",
            },
            take: MAX_LIST_ITEMS,
          }),
        ]);

        actorPendingCount = count;
        actorPendingRequests = assignedRows.map((row) => ({
          approval_instance_id: row.id,
          request_db_id: row.request.id,
          request_id: row.request.request_id,
          step_order: row.step_order,
          request_status: row.request.request_approval_status,
          requester_name: row.request.user?.name || "Unknown",
          department_name: row.request.department?.name || "Unknown",
          requisition_date: row.request.requisition_date.toISOString(),
        }));
      } catch (error) {
        // Some environments may not have workflow tables fully available.
      }
    }

    return {
      data_source: "prisma.request (+ requisition_approval_instances for actor-specific pending)",
      overall_pending_count: overallPendingCount,
      awaiting_hod_count: awaitingHodCount,
      awaiting_exec_pastor_count: awaitingExecPastorCount,
      latest_pending_requests: latestPending,
      actor_pending_count: actorPendingCount,
      actor_pending_requests: actorPendingRequests,
    };
  }

  private async getOperationalSnapshotKnowledge(): Promise<DbKnowledge["operational_snapshot"]> {
    const { startOfDay, endOfDay } = this.getTodayBoundsServerLocal();

    const [
      totalMembers,
      activePrograms,
      pendingRequisitions,
      upcomingEvents,
      pendingAppointmentsToday,
      visitorsToday,
    ] = await Promise.all([
      prisma.user_info.count({
        where: {
          user: {
            membership_type: {
              in: [...MEMBERSHIP_TYPES],
            },
          },
        },
      }),
      prisma.program.count({
        where: {
          completed: false,
          cohorts: {
            some: {
              status: {
                in: [...ACTIVE_COHORT_STATUSES],
              },
            },
          },
        },
      }),
      prisma.request.count({
        where: {
          request_approval_status: {
            in: [...PENDING_REQUISITION_STATUSES],
          },
        },
      }),
      prisma.event_mgt.count({
        where: {
          OR: [
            {
              start_date: {
                gte: startOfDay,
              },
            },
            {
              end_date: {
                gte: startOfDay,
              },
            },
          ],
        },
      }),
      prisma.appointment.count({
        where: {
          status: appointment_status.PENDING,
          date: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      }),
      prisma.visitor.count({
        where: {
          visitDate: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      }),
    ]);

    return {
      data_source: "prisma.user_info + program + request + event_mgt + appointment + visitor",
      date_basis: "server_local_time",
      date: startOfDay.toISOString().slice(0, 10),
      total_members: totalMembers,
      active_programs: activePrograms,
      pending_requisitions: pendingRequisitions,
      upcoming_events: upcomingEvents,
      pending_appointments_today: pendingAppointmentsToday,
      visitors_today: visitorsToday,
    };
  }

  private async getMemberMetrics(): Promise<MemberMetrics> {
    const [totalMembers, onlineMembers, inhouseMembers, groupedByGender] =
      await Promise.all([
        prisma.user_info.count({
          where: {
            user: {
              membership_type: {
                in: [...MEMBERSHIP_TYPES],
              },
            },
          },
        }),
        prisma.user_info.count({
          where: {
            user: {
              membership_type: "ONLINE",
            },
          },
        }),
        prisma.user_info.count({
          where: {
            user: {
              membership_type: "IN_HOUSE",
            },
          },
        }),
        prisma.user_info.groupBy({
          by: ["gender"],
          where: {
            user: {
              membership_type: {
                in: [...MEMBERSHIP_TYPES],
              },
            },
          },
          _count: {
            _all: true,
          },
        }),
      ]);

    let maleMembers = 0;
    let femaleMembers = 0;
    let otherMembers = 0;

    for (const row of groupedByGender) {
      const normalized = this.normalizeGender(row.gender);
      const count = row._count._all;
      if (normalized === "male") {
        maleMembers += count;
      } else if (normalized === "female") {
        femaleMembers += count;
      } else {
        otherMembers += count;
      }
    }

    return {
      source: "prisma.user_info + user.membership_type",
      total_members: totalMembers,
      online_members: onlineMembers,
      inhouse_members: inhouseMembers,
      male_members: maleMembers,
      female_members: femaleMembers,
      other_members: otherMembers,
    };
  }

  private async getAttendanceTodayMetrics(): Promise<AttendanceTodayMetrics> {
    const { startOfDay, endOfDay } = this.getTodayBoundsServerLocal();

    const aggregate = await prisma.event_attendance_summary.aggregate({
      where: {
        date: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        adultMale: true,
        youthMale: true,
        childrenMale: true,
        adultFemale: true,
        youthFemale: true,
        childrenFemale: true,
        visitors: true,
        newMembers: true,
        visitingPastors: true,
      },
    });

    const adultMale = Number(aggregate._sum.adultMale || 0);
    const youthMale = Number(aggregate._sum.youthMale || 0);
    const childrenMale = Number(aggregate._sum.childrenMale || 0);
    const adultFemale = Number(aggregate._sum.adultFemale || 0);
    const youthFemale = Number(aggregate._sum.youthFemale || 0);
    const childrenFemale = Number(aggregate._sum.childrenFemale || 0);

    return {
      source: "prisma.event_attendance_summary",
      date: startOfDay.toISOString().slice(0, 10),
      day_basis: "server_local_time",
      window_start: startOfDay.toISOString(),
      window_end: endOfDay.toISOString(),
      records: aggregate._count._all,
      male_total: adultMale + youthMale + childrenMale,
      female_total: adultFemale + youthFemale + childrenFemale,
      adult_male: adultMale,
      youth_male: youthMale,
      children_male: childrenMale,
      adult_female: adultFemale,
      youth_female: youthFemale,
      children_female: childrenFemale,
      visitors: Number(aggregate._sum.visitors || 0),
      new_members: Number(aggregate._sum.newMembers || 0),
      visiting_pastors: Number(aggregate._sum.visitingPastors || 0),
    };
  }

  private detectIntents(message: string): Set<string> {
    const intents = new Set<string>();

    if (this.matchesAny(message, ACTIVE_PROGRAM_INTENT_PATTERNS)) {
      intents.add("active_program_lookup");
    }
    if (this.matchesAny(message, PROGRAM_PREREQUISITE_PATTERNS)) {
      intents.add("program_prerequisite_lookup");
    }
    if (this.matchesAny(message, PENDING_APPROVAL_INTENT_PATTERNS)) {
      intents.add("pending_approval_lookup");
    }
    if (this.matchesAny(message, SUMMARY_INTENT_PATTERNS)) {
      intents.add("summary_lookup");
    }
    if (this.matchesAny(message, OPERATIONAL_SNAPSHOT_PATTERNS)) {
      intents.add("operational_snapshot_lookup");
    }
    if (this.matchesAny(message, ATTENDANCE_LOOKUP_PATTERNS)) {
      intents.add("attendance_lookup");
    }

    return intents;
  }

  private detectEntityHints(message: string): Set<string> {
    const hints = new Set<string>();
    if (this.matchesAny(message, PROGRAM_ENTITY_PATTERNS)) hints.add("program");
    if (this.matchesAny(message, REQUISITION_ENTITY_PATTERNS)) hints.add("requisition");
    if (this.matchesAny(message, MEMBER_INTENT_PATTERNS)) hints.add("member");
    if (this.matchesAny(message, ATTENDANCE_INTENT_PATTERNS)) hints.add("attendance");
    if (this.matchesAny(message, EVENT_ENTITY_PATTERNS)) hints.add("event");
    if (this.matchesAny(message, VISITOR_ENTITY_PATTERNS)) hints.add("visitor");
    if (this.matchesAny(message, APPOINTMENT_ENTITY_PATTERNS)) hints.add("appointment");
    if (this.matchesAny(message, PRODUCT_ENTITY_PATTERNS)) hints.add("product");
    return hints;
  }

  private extractProgramNameForPrerequisiteLookup(message: string): string | null {
    const quotedMatch = message.match(/(?:"([^"]+)")|(?:'([^']+)')/);
    if (quotedMatch) {
      const candidate = quotedMatch[1] || quotedMatch[2] || "";
      const normalized = this.cleanProgramName(candidate);
      return normalized || null;
    }

    const patterns = [
      /prerequisites?\s+(?:of|for)\s+(.+)$/i,
      /program\s+(.+)\s+prerequisites?/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (!match?.[1]) continue;
      const normalized = this.cleanProgramName(match[1]);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private cleanProgramName(value: string): string {
    return value
      .replace(/[?.,!]+$/g, "")
      .replace(/^the\s+/i, "")
      .trim();
  }

  private extractLookupPhrase(message: string): string {
    const quotedMatch = message.match(/(?:"([^"]+)")|(?:'([^']+)')/);
    if (quotedMatch) {
      const candidate = (quotedMatch[1] || quotedMatch[2] || "").trim();
      if (candidate.length >= 2) {
        return candidate;
      }
    }

    const cleaned = message
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()))
      .slice(0, 5)
      .join(" ")
      .trim();

    return cleaned;
  }

  private hasDateLikeToken(message: string): boolean {
    return this.extractDateForAttendanceLookup(message) !== null;
  }

  private extractDateForAttendanceLookup(message: string): Date | null {
    const isoMatch = message.match(DATE_ISO_CAPTURE_REGEX);
    if (isoMatch) {
      const date = this.buildLocalDate(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
      );
      if (date) return date;
    }

    const monthDayYearMatch = message.match(DATE_MONTH_DAY_YEAR_CAPTURE_REGEX);
    if (monthDayYearMatch) {
      const monthIndex = this.resolveMonthIndex(monthDayYearMatch[1]);
      if (monthIndex !== null) {
        const date = this.buildLocalDate(
          Number(monthDayYearMatch[3]),
          monthIndex,
          Number(monthDayYearMatch[2]),
        );
        if (date) return date;
      }
    }

    const dayMonthYearMatch = message.match(DATE_DAY_MONTH_YEAR_CAPTURE_REGEX);
    if (dayMonthYearMatch) {
      const monthIndex = this.resolveMonthIndex(dayMonthYearMatch[2]);
      if (monthIndex !== null) {
        const date = this.buildLocalDate(
          Number(dayMonthYearMatch[3]),
          monthIndex,
          Number(dayMonthYearMatch[1]),
        );
        if (date) return date;
      }
    }

    const yearMonthDayTextMatch = message.match(DATE_YEAR_MONTH_DAY_TEXT_CAPTURE_REGEX);
    if (yearMonthDayTextMatch) {
      const monthIndex = this.resolveMonthIndex(yearMonthDayTextMatch[2]);
      if (monthIndex !== null) {
        const year = Number(yearMonthDayTextMatch[4] || yearMonthDayTextMatch[1]);
        const date = this.buildLocalDate(year, monthIndex, Number(yearMonthDayTextMatch[3]));
        if (date) return date;
      }
    }

    const relativeDate = this.extractRelativeDateForAttendanceLookup(message);
    if (relativeDate) {
      return relativeDate;
    }

    return null;
  }

  private extractEventNameForAttendanceLookup(message: string): string | null {
    const quotedMatch = message.match(/(?:"([^"]+)")|(?:'([^']+)')/);
    if (quotedMatch) {
      const candidate = quotedMatch[1] || quotedMatch[2] || "";
      const normalized = this.cleanEventLookupText(candidate);
      if (normalized.length >= 3) {
        return normalized;
      }
    }

    const patterns = [
      /(?:attendance|attend[a-z]*)\s+(?:for|of)\s+(.+)$/i,
      /for\s+(.+?)\s+(?:on|at)\s+.+$/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (!match?.[1]) continue;
      const normalized = this.cleanEventLookupText(match[1]);
      if (normalized.length >= 3) {
        return normalized;
      }
    }

    const fallback = this.cleanEventLookupText(this.extractLookupPhrase(message));
    if (this.isGenericAttendanceEventText(fallback)) {
      return null;
    }
    return fallback.length >= 3 ? fallback : null;
  }

  private cleanEventLookupText(value: string): string {
    return value
      .replace(DATE_ISO_REGEX, " ")
      .replace(DATE_MONTH_DAY_YEAR_REGEX, " ")
      .replace(DATE_DAY_MONTH_YEAR_REGEX, " ")
      .replace(DATE_YEAR_MONTH_DAY_TEXT_REGEX, " ")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^the\s+/i, "")
      .trim();
  }

  private resolveMonthIndex(monthToken: string): number | null {
    const normalized = String(monthToken || "").trim().toLowerCase();
    if (!normalized) return null;
    const value = MONTH_TOKEN_TO_INDEX[normalized];
    return Number.isInteger(value) ? value : null;
  }

  private extractRelativeDateForAttendanceLookup(message: string): Date | null {
    const normalized = String(message || "").toLowerCase();
    if (!normalized) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (/\btoday\b/.test(normalized)) {
      return new Date(today);
    }

    if (/\byesterday\b/.test(normalized)) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    }

    if (/\btomorrow\b/.test(normalized)) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }

    const directionalWeekdayMatch = normalized.match(
      /\b(last|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    );
    if (directionalWeekdayMatch) {
      return this.resolveRelativeWeekday(
        directionalWeekdayMatch[2],
        directionalWeekdayMatch[1].toLowerCase() as "last" | "this" | "next",
      );
    }

    const plainWeekdayMatch = normalized.match(
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    );
    if (plainWeekdayMatch) {
      return this.resolveRelativeWeekday(plainWeekdayMatch[1], "recent");
    }

    return null;
  }

  private resolveRelativeWeekday(
    weekdayToken: string,
    mode: "last" | "this" | "next" | "recent",
  ): Date | null {
    const normalizedWeekday = String(weekdayToken || "").trim().toLowerCase();
    const targetDay = WEEKDAY_TOKEN_TO_INDEX[normalizedWeekday];
    if (!Number.isInteger(targetDay)) {
      return null;
    }

    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const currentDay = base.getDay();

    let delta = 0;
    if (mode === "last") {
      delta = -((currentDay - targetDay + 7) % 7 || 7);
    } else if (mode === "next") {
      delta = (targetDay - currentDay + 7) % 7 || 7;
    } else if (mode === "this") {
      delta = targetDay - currentDay;
    } else {
      delta = -((currentDay - targetDay + 7) % 7);
    }

    const resolved = new Date(base);
    resolved.setDate(resolved.getDate() + delta);
    return resolved;
  }

  private isGenericAttendanceEventText(value: string): boolean {
    const normalized = String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return true;
    }

    const tokens = normalized.split(" ").filter(Boolean);
    if (!tokens.length) {
      return true;
    }

    const meaningful = tokens.filter(
      (token) => !GENERIC_ATTENDANCE_EVENT_TOKENS.has(token),
    );

    return meaningful.length === 0;
  }

  private buildLocalDate(year: number, monthIndex: number, day: number): Date | null {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
      return null;
    }

    if (year < 1900 || year > 2200 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(year, monthIndex, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== monthIndex ||
      date.getDate() !== day
    ) {
      return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getDayBounds(date: Date): { startOfDay: Date; endOfDay: Date } {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    return { startOfDay, endOfDay };
  }

  private normalizeModuleName(moduleValue: unknown): string {
    if (typeof moduleValue !== "string") {
      return "";
    }
    return moduleValue.trim().toLowerCase();
  }

  private normalizeGender(value: unknown): "male" | "female" | "other" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "male" || normalized === "m") {
      return "male";
    }
    if (normalized === "female" || normalized === "f") {
      return "female";
    }
    return "other";
  }

  private getTodayBoundsServerLocal(): { startOfDay: Date; endOfDay: Date } {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    return { startOfDay, endOfDay };
  }

  private matchesAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
  }
}

const MEMBER_INTENT_PATTERNS = [
  /\bmember\b/i,
  /\bmembers\b/i,
  /\bmale\b/i,
  /\bfemale\b/i,
  /\bgender\b/i,
];

const ATTENDANCE_INTENT_PATTERNS = [
  /\battendance\b/i,
  /\battend[a-z]*\b/i,
  /\bcame\s+to\s+church\b/i,
  /\bchurch\s+today\b/i,
  /\btoday\b/i,
];
const ATTENDANCE_LOOKUP_PATTERNS = [
  /\battend[a-z]*\b/i,
  /\btotal\b.*\battend[a-z]*\b/i,
  /\battend[a-z]*\b.*\bfor\b/i,
  /\battend[a-z]*\b.*\bon\b/i,
  /\bhow\s+many\b.*\battend[a-z]*\b/i,
  /\bhead\s*count\b/i,
  /\bwho\s+came\b/i,
  /\bcame\s+to\s+church\b/i,
];

const ACTIVE_PROGRAM_INTENT_PATTERNS = [
  /\bcurrent\b.*\bprogram\b/i,
  /\bactive\b.*\bprogram\b/i,
  /\bongoing\b.*\bprogram\b/i,
  /\bupcoming\b.*\bprogram\b/i,
  /\bprogram\b.*\bcurrent\b/i,
  /\bprogram\b.*\bactive\b/i,
];

const PROGRAM_PREREQUISITE_PATTERNS = [
  /\bprerequisite\b/i,
  /\bprerequisites\b/i,
];

const PENDING_APPROVAL_INTENT_PATTERNS = [
  /\bpending\b.*\bapproval\b/i,
  /\bawaiting\b.*\bapproval\b/i,
  /\bpending\b.*\brequisition\b/i,
  /\bpending\b.*\brequest\b/i,
  /\bapproval\b.*\bpending\b/i,
];

const SUMMARY_INTENT_PATTERNS = [
  /\bsummary\b/i,
  /\boverview\b/i,
  /\bdashboard\b/i,
  /\bsnapshot\b/i,
  /\bstatus\b/i,
];

const OPERATIONAL_SNAPSHOT_PATTERNS = [/\boperations\b/i, /\boperational\b/i];

const PROGRAM_ENTITY_PATTERNS = [/\bprogram\b/i, /\bcohort\b/i, /\bcourse\b/i];
const REQUISITION_ENTITY_PATTERNS = [
  /\brequisition\b/i,
  /\brequest\b/i,
  /\bapproval\b/i,
];
const EVENT_ENTITY_PATTERNS = [/\bevent\b/i, /\bservice\b/i];
const VISITOR_ENTITY_PATTERNS = [/\bvisitor\b/i, /\bvisit\b/i];
const APPOINTMENT_ENTITY_PATTERNS = [/\bappointment\b/i, /\bbooking\b/i];
const PRODUCT_ENTITY_PATTERNS = [/\bproduct\b/i, /\border\b/i, /\bmarket\b/i];

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "has",
  "what",
  "which",
  "when",
  "where",
  "who",
  "whom",
  "whose",
  "can",
  "could",
  "would",
  "should",
  "about",
  "into",
  "then",
  "than",
  "them",
  "they",
  "you",
  "your",
  "our",
  "their",
]);

const MONTH_NAME_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_ISO_CAPTURE_REGEX = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/i;
const DATE_MONTH_DAY_YEAR_CAPTURE_REGEX = new RegExp(
  `\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(\\d{4})\\b`,
  "i",
);
const DATE_DAY_MONTH_YEAR_CAPTURE_REGEX = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_PATTERN})\\s+(\\d{4})\\b`,
  "i",
);
const DATE_YEAR_MONTH_DAY_TEXT_CAPTURE_REGEX = new RegExp(
  `\\b(\\d{4})\\s+(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?\\b`,
  "i",
);
const DATE_ISO_REGEX = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/gi;
const DATE_MONTH_DAY_YEAR_REGEX = new RegExp(
  `\\b(?:${MONTH_NAME_PATTERN})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*|\\s+)\\d{4}\\b`,
  "gi",
);
const DATE_DAY_MONTH_YEAR_REGEX = new RegExp(
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAME_PATTERN})\\s+\\d{4}\\b`,
  "gi",
);
const DATE_YEAR_MONTH_DAY_TEXT_REGEX = new RegExp(
  `\\b\\d{4}\\s+(?:${MONTH_NAME_PATTERN})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?\\b`,
  "gi",
);
const MONTH_TOKEN_TO_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_TOKEN_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const GENERIC_ATTENDANCE_EVENT_TOKENS = new Set([
  "attendance",
  "attendace",
  "attendence",
  "attendees",
  "attendee",
  "total",
  "totals",
  "current",
  "today",
  "headcount",
  "head",
  "count",
  "who",
  "came",
  "come",
  "church",
  "service",
  "last",
  "this",
  "next",
  "week",
  "month",
  "year",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);
