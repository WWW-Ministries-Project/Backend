import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { notificationService } from "../../notifications/notificationService";
import { EnrollmentService } from "../enrolmentService";
import { eligibilityReasons } from "./eligibility";
import { LmsError } from "./lmsHttp";

const personName = (user: { name: string | null; user_info?: { first_name: string | null; last_name: string | null } | null } | null) =>
  [user?.user_info?.first_name, user?.user_info?.last_name].filter(Boolean).join(" ").trim() || user?.name || "Member";

const MY_LEARNING_URL = "/member/school-of-ministries/programs/my-enrolled-programs";

export class ApplicationService {
  private enrollments = new EnrollmentService();

  /** Reasons a person would be held back from a class, using the same checks as enrollUser plus program flags. */
  async checkEligibility(userId: number, courseId: number) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        enrolled: true,
        capacity: true,
        cohortId: true,
        cohort: {
          select: {
            programId: true,
            program: { select: { member_required: true, leader_required: true, ministry_required: true } },
          },
        },
      },
    });
    if (!course) throw new LmsError("Class not found", 404);

    const [user, prerequisites, existing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          is_guest: true,
          position_id: true,
          department_id: true,
          department_head: { select: { id: true }, take: 1 },
          department_positions: { select: { id: true }, take: 1 },
        },
      }),
      prisma.program_prerequisites.findMany({
        where: { programId: course.cohort.programId },
        select: {
          prerequisite: {
            select: {
              title: true,
              topics: {
                select: { progress: { where: { enrollment: { user_id: userId }, status: "PASS" }, select: { id: true } } },
              },
            },
          },
        },
      }),
      prisma.enrollment.findFirst({
        where: { user_id: userId, course: { cohort: { programId: course.cohort.programId } } },
        select: { id: true },
      }),
    ]);
    if (!user) throw new LmsError("Member not found", 404);

    // Same leniency as enrollUser: a prerequisite counts once any of its topics is passed.
    const incomplete = prerequisites
      .map((p) => p.prerequisite)
      .filter((p) => p.topics.length > 0 && !p.topics.some((t) => t.progress.length > 0))
      .map((p) => p.title);

    return {
      course,
      programId: course.cohort.programId,
      alreadyEnrolled: Boolean(existing),
      reasons: eligibilityReasons({
        program: course.cohort.program,
        person: {
          isGuest: user.is_guest === true,
          isLeader: user.department_head.length > 0 || user.position_id !== null,
          inMinistry: user.department_id !== null || user.department_positions.length > 0,
        },
        incompletePrerequisites: incomplete,
        seats: { enrolled: course.enrolled, capacity: course.capacity },
      }),
    };
  }

  /**
   * Member applies for a class: eligible applicants are enrolled straight away,
   * the rest are queued for review. The existing POST /enroll is unchanged.
   */
  async apply(userId: number, courseId: number, note: string | null) {
    const check = await this.checkEligibility(userId, courseId);
    if (check.alreadyEnrolled) throw new LmsError("You are already enrolled in this program", 409);

    if (!check.reasons.length) {
      const enrollment = await this.enrollments.enrollUser({ course_id: courseId, user_id: userId });
      return { status: "ENROLLED" as const, enrollmentId: enrollment?.id ?? null, reasons: [] as string[] };
    }

    const pending = await prisma.lms_application.findFirst({
      where: { userId, programId: check.programId, status: "PENDING" },
      select: { id: true },
    });
    const data = {
      cohortId: check.course.cohortId,
      courseId,
      reasons: check.reasons as unknown as Prisma.InputJsonValue,
      note,
    };
    const application = pending
      ? await prisma.lms_application.update({ where: { id: pending.id }, data })
      : await prisma.lms_application.create({ data: { ...data, userId, programId: check.programId } });
    return { status: "PENDING" as const, applicationId: application.id, reasons: check.reasons };
  }

  async list(filters: { status?: string; programId?: number }) {
    const rows = await prisma.lms_application.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.programId ? { programId: filters.programId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        user: { select: { id: true, name: true, email: true, user_info: { select: { first_name: true, last_name: true } } } },
        program: { select: { id: true, title: true } },
        cohort: { select: { id: true, name: true } },
        course: { select: { id: true, name: true, enrolled: true, capacity: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      reasons: (Array.isArray(r.reasons) ? r.reasons : []) as string[],
      note: r.note,
      createdAt: r.createdAt,
      decidedAt: r.decided_at,
      enrollmentId: r.enrollmentId,
      user: { id: r.user.id, name: personName(r.user), email: r.user.email },
      program: r.program,
      cohort: r.cohort,
      course: r.course,
    }));
  }

  /**
   * Admin decision. Approving enrolls the applicant even if the class is full or
   * a rule failed (that is the point of the override).
   */
  async decide(args: {
    id: number;
    decision: "APPROVE" | "DECLINE";
    courseId: number | null;
    note: string | null;
    actorUserId: number | null;
  }) {
    const app = await prisma.lms_application.findUnique({
      where: { id: args.id },
      include: { program: { select: { id: true, title: true } } },
    });
    if (!app) throw new LmsError("Application not found", 404);
    if (app.status !== "PENDING") throw new LmsError("This application has already been decided", 409);

    if (args.decision === "DECLINE") {
      const updated = await prisma.lms_application.update({
        where: { id: app.id },
        data: { status: "DECLINED", note: args.note ?? app.note, decided_by: args.actorUserId, decided_at: new Date() },
      });
      await this.notify(app.userId, args.actorUserId, "program.application.declined", "Application not approved",
        `Your application to ${app.program.title} was not approved this time.`, app.programId);
      return updated;
    }

    const courseId = args.courseId ?? app.courseId;
    if (!courseId) throw new LmsError("Choose a class to enroll the applicant in");
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, cohortId: true, cohort: { select: { programId: true } } },
    });
    if (!course || course.cohort.programId !== app.programId) throw new LmsError("The class is not part of this program");

    const enrollmentId = await prisma.$transaction(async (tx) => {
      const existing = await tx.enrollment.findFirst({
        where: { user_id: app.userId, course: { cohort: { programId: app.programId } } },
        select: { id: true },
      });
      if (existing) throw new LmsError("The member is already enrolled in this program", 409);

      const enrollment = await tx.enrollment.create({
        data: { user_id: app.userId, course_id: courseId, enrolledAt: new Date() },
        select: { id: true },
      });
      await tx.course.update({ where: { id: courseId }, data: { enrolled: { increment: 1 } } });
      const topics = await tx.topic.findMany({ where: { programId: app.programId }, select: { id: true } });
      if (topics.length) {
        await tx.progress.createMany({
          data: topics.map((t) => ({ enrollmentId: enrollment.id, topicId: t.id, score: 0, status: "PENDING" as const })),
        });
      }
      await tx.lms_application.update({
        where: { id: app.id },
        data: {
          status: "APPROVED",
          courseId,
          cohortId: course.cohortId,
          enrollmentId: enrollment.id,
          note: args.note ?? app.note,
          decided_by: args.actorUserId,
          decided_at: new Date(),
        },
      });
      return enrollment.id;
    });

    await this.notify(app.userId, args.actorUserId, "program.application.approved", "You're enrolled",
      `You have been enrolled in ${app.program.title} (${course.name}).`, app.programId);
    return { id: app.id, status: "APPROVED", enrollmentId };
  }

  private async notify(
    recipientUserId: number,
    actorUserId: number | null,
    type: string,
    title: string,
    body: string,
    programId: number,
  ) {
    try {
      await notificationService.createInAppNotification({
        type,
        title,
        body,
        recipientUserId,
        actorUserId: actorUserId ?? undefined,
        entityType: "program",
        entityId: String(programId),
        actionUrl: MY_LEARNING_URL,
        priority: "MEDIUM",
      });
    } catch {
      // Notification failures must not undo an enrollment decision.
    }
  }
}

export const applicationService = new ApplicationService();
