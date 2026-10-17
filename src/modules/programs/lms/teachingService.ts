import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { createGeneralDispatch } from "../../messaging/messagingService";
import { assessmentService } from "./assessmentService";
import { attendanceByEnrollment } from "./attendanceQuery";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./gradebookMath";
import { LmsError } from "./lmsHttp";

export const SESSION_MODES = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
export const ANNOUNCEMENT_AUDIENCES = ["COHORT", "CLASS", "AT_RISK"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

const personName = (user: { name: string | null; user_info?: { first_name: string | null; last_name: string | null } | null } | null) =>
  [user?.user_info?.first_name, user?.user_info?.last_name].filter(Boolean).join(" ").trim() || user?.name || "Learner";

const userSelect = { name: true, user_info: { select: { first_name: true, last_name: true } } } as const;

/** Enrollments a session covers: its class, or every class in the cohort. */
const sessionScopeWhere = (s: { cohortId: number; courseId: number | null }): Prisma.enrollmentWhereInput =>
  s.courseId ? { course_id: s.courseId } : { course: { cohortId: s.cohortId } };

type SessionInput = {
  cohortId?: number;
  courseId?: number | null;
  title?: string;
  starts_at?: Date;
  ends_at?: Date | null;
  mode?: string;
  location?: string | null;
  meeting_link?: string | null;
  week?: number | null;
  cancelled?: boolean;
  notes?: string | null;
};

export class TeachingService {
  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  private async validateSession(input: SessionInput, existing?: { cohortId: number }) {
    const cohortId = input.cohortId ?? existing?.cohortId;
    if (!cohortId) throw new LmsError("cohortId is required");
    if (input.courseId) {
      const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { cohortId: true } });
      if (!course || course.cohortId !== cohortId) throw new LmsError("The class does not belong to this cohort");
    }
    if (input.mode !== undefined && !SESSION_MODES.includes(input.mode as (typeof SESSION_MODES)[number])) {
      throw new LmsError("mode must be IN_PERSON, ONLINE or HYBRID");
    }
    if (input.starts_at && input.ends_at && input.ends_at < input.starts_at) {
      throw new LmsError("A session cannot end before it starts");
    }
    if (input.meeting_link) {
      try {
        const url = new URL(input.meeting_link);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      } catch {
        throw new LmsError("meeting_link must be an http(s) link");
      }
    }
    return cohortId;
  }

  async listSessions(filters: {
    cohortId?: number;
    courseId?: number;
    from?: Date;
    to?: Date;
    cohortIds?: number[];
    branchId?: unknown;
  }) {
    const where: Prisma.lms_sessionWhereInput = {};
    const branchWhere = getBranchScopedWhere(filters.branchId);
    if (branchWhere) where.cohort = { program: branchWhere };
    if (filters.cohortId) where.cohortId = filters.cohortId;
    if (filters.cohortIds) where.cohortId = { in: filters.cohortIds };
    if (filters.courseId) where.OR = [{ courseId: filters.courseId }, { courseId: null }];
    if (filters.from || filters.to) where.starts_at = { gte: filters.from, lte: filters.to };

    const sessions = await prisma.lms_session.findMany({
      where,
      orderBy: { starts_at: "asc" },
      take: 500,
      include: {
        cohort: { select: { id: true, name: true, program: { select: { id: true, title: true } } } },
        course: { select: { id: true, name: true, instructor: { select: userSelect } } },
        attendance: { select: { status: true } },
      },
    });

    // Learners expected per scope (cohort-wide sessions cover every class).
    const cohortIds = Array.from(new Set(sessions.map((s) => s.cohortId)));
    const counts = cohortIds.length
      ? await prisma.enrollment.groupBy({
          by: ["course_id"],
          where: { course: { cohortId: { in: cohortIds } } },
          _count: { _all: true },
        })
      : [];
    const courseCohort = cohortIds.length
      ? await prisma.course.findMany({ where: { cohortId: { in: cohortIds } }, select: { id: true, cohortId: true } })
      : [];
    const perCourse = new Map(counts.map((c) => [c.course_id, c._count._all]));
    const perCohort = new Map<number, number>();
    courseCohort.forEach((c) => perCohort.set(c.cohortId, (perCohort.get(c.cohortId) ?? 0) + (perCourse.get(c.id) ?? 0)));

    return sessions.map(({ attendance, ...s }) => {
      const tally = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 } as Record<AttendanceStatus, number>;
      attendance.forEach((a) => {
        if (a.status in tally) tally[a.status as AttendanceStatus] += 1;
      });
      return {
        ...s,
        course: s.course ? { id: s.course.id, name: s.course.name, instructor: s.course.instructor ? personName(s.course.instructor) : null } : null,
        expected: s.courseId ? (perCourse.get(s.courseId) ?? 0) : (perCohort.get(s.cohortId) ?? 0),
        recorded: attendance.length,
        tally,
      };
    });
  }

  async createSession(input: SessionInput & { title: string; starts_at: Date; mode: string }, userId: number | null) {
    const cohortId = await this.validateSession(input);
    return prisma.lms_session.create({
      data: {
        cohortId,
        courseId: input.courseId ?? null,
        title: input.title,
        starts_at: input.starts_at,
        ends_at: input.ends_at ?? null,
        mode: input.mode,
        location: input.location ?? null,
        meeting_link: input.meeting_link ?? null,
        week: input.week ?? null,
        notes: input.notes ?? null,
        created_by: userId,
      },
    });
  }

  async getSession(id: number) {
    const session = await prisma.lms_session.findUnique({ where: { id } });
    if (!session) throw new LmsError("Session not found", 404);
    return session;
  }

  async updateSession(id: number, input: SessionInput) {
    const existing = await this.getSession(id);
    await this.validateSession(
      { ...input, starts_at: input.starts_at ?? existing.starts_at, ends_at: input.ends_at === undefined ? existing.ends_at : input.ends_at },
      existing,
    );
    const { cohortId: _ignored, ...data } = input;
    return prisma.lms_session.update({ where: { id }, data });
  }

  async deleteSession(id: number) {
    await this.getSession(id);
    await prisma.lms_session.delete({ where: { id } });
    return { id };
  }

  // ---------------------------------------------------------------------------
  // Attendance
  // ---------------------------------------------------------------------------

  async getSessionAttendance(sessionId: number) {
    const session = await this.getSession(sessionId);
    const enrollments = await prisma.enrollment.findMany({
      where: sessionScopeWhere(session),
      select: {
        id: true,
        user: { select: userSelect },
        course: { select: { id: true, name: true } },
        lms_attendance: { where: { sessionId }, select: { status: true, note: true } },
      },
    });
    return {
      session,
      learners: enrollments
        .map((e) => ({
          enrollmentId: e.id,
          name: personName(e.user),
          classId: e.course.id,
          className: e.course.name,
          status: (e.lms_attendance[0]?.status as AttendanceStatus | undefined) ?? null,
          note: e.lms_attendance[0]?.note ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async saveAttendance(
    sessionId: number,
    records: { enrollmentId: number; status: string; note?: string | null }[],
    userId: number | null,
  ) {
    const session = await this.getSession(sessionId);
    if (session.cancelled) throw new LmsError("This session was cancelled");
    if (records.some((r) => !ATTENDANCE_STATUSES.includes(r.status as AttendanceStatus))) {
      throw new LmsError("status must be PRESENT, LATE, ABSENT or EXCUSED");
    }
    if (records.some((r) => (r.note?.length ?? 0) > 191)) {
      throw new LmsError("Attendance notes must be at most 191 characters");
    }
    const ids = records.map((r) => r.enrollmentId);
    const inScope = await prisma.enrollment.count({ where: { AND: [{ id: { in: ids } }, sessionScopeWhere(session)] } });
    if (inScope !== new Set(ids).size) throw new LmsError("Some learners are not part of this session");

    await prisma.$transaction(
      records.map((r) =>
        prisma.lms_attendance.upsert({
          where: { sessionId_enrollmentId: { sessionId, enrollmentId: r.enrollmentId } },
          update: { status: r.status, note: r.note ?? null, recorded_by: userId },
          create: { sessionId, enrollmentId: r.enrollmentId, status: r.status, note: r.note ?? null, recorded_by: userId },
        }),
      ),
    );
    return this.getSessionAttendance(sessionId);
  }

  /** Attendance % per enrollment in a cohort, for the gradebook and at-risk rules. */
  attendanceByEnrollment(cohortId: number) {
    return attendanceByEnrollment(cohortId);
  }

  // ---------------------------------------------------------------------------
  // Announcements (delivered by the messaging outbox)
  // ---------------------------------------------------------------------------

  async listAnnouncements(cohortId: number) {
    const rows = await prisma.lms_announcement.findMany({
      where: { cohortId },
      orderBy: { createdAt: "desc" },
      include: { course: { select: { id: true, name: true } } },
    });
    const dispatchIds = rows.map((r) => r.dispatch_id).filter((id): id is number => typeof id === "number");
    const dispatches = dispatchIds.length
      ? await prisma.message_dispatch.findMany({
          where: { id: { in: dispatchIds } },
          select: { id: true, status: true, counts: true },
        })
      : [];
    const byId = new Map(dispatches.map((d) => [d.id, d]));
    const senders = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.sent_by).filter((id): id is number => typeof id === "number") } },
      select: { id: true, ...userSelect },
    });
    const senderName = new Map(senders.map((u) => [u.id, personName(u)]));
    return rows.map((r) => ({
      ...r,
      sentByName: r.sent_by ? (senderName.get(r.sent_by) ?? null) : null,
      delivery: r.dispatch_id ? (byId.get(r.dispatch_id) ?? null) : null,
    }));
  }

  private async resolveAudience(cohortId: number, audience: AnnouncementAudience, courseId: number | null) {
    if (audience === "AT_RISK") {
      const book = await assessmentService.getGradebook(cohortId, courseId);
      return book.rows.filter((r) => r.status === "At risk").map((r) => r.userId).filter((id): id is number => !!id);
    }
    const enrollments = await prisma.enrollment.findMany({
      where: audience === "CLASS" ? { course_id: courseId! } : { course: { cohortId } },
      select: { user_id: true },
    });
    return Array.from(new Set(enrollments.map((e) => e.user_id).filter((id): id is number => !!id)));
  }

  async createAnnouncement(
    input: {
      cohortId: number;
      courseId: number | null;
      audience: AnnouncementAudience;
      title: string;
      body: string;
      channels: { inApp: boolean; email: boolean; sms: boolean };
      scheduledFor: string | null;
    },
    userId: number | null,
  ) {
    if (input.courseId) {
      const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { cohortId: true } });
      if (!course || course.cohortId !== input.cohortId) throw new LmsError("The class does not belong to this cohort");
    }
    if (input.audience === "CLASS" && !input.courseId) throw new LmsError("Choose a class");

    const userIds = await this.resolveAudience(input.cohortId, input.audience, input.courseId);
    if (!userIds.length) throw new LmsError("Nobody matches this audience yet");

    // Validation of title/body/channels/schedule happens in the messaging module.
    const dispatch = await createGeneralDispatch(
      {
        title: input.title,
        body: input.body,
        emailSubject: input.title,
        channels: input.channels,
        audience: { scope: "PEOPLE", userIds },
        scheduledFor: input.scheduledFor,
      },
      userId,
    );

    return prisma.lms_announcement.create({
      data: {
        cohortId: input.cohortId,
        courseId: input.courseId,
        audience: input.audience,
        title: input.title,
        body: input.body,
        channels: input.channels as unknown as Prisma.InputJsonValue,
        recipient_count: userIds.length,
        dispatch_id: (dispatch as { id?: number } | null)?.id ?? null,
        scheduled_for: input.scheduledFor ? new Date(input.scheduledFor) : null,
        sent_by: userId,
      },
    });
  }
}

export const teachingService = new TeachingService();
