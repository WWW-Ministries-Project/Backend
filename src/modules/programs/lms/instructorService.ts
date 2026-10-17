import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { LmsError } from "./lmsHttp";

const personName = (user: { name: string | null; user_info?: { first_name: string | null; last_name: string | null } | null } | null) =>
  [user?.user_info?.first_name, user?.user_info?.last_name].filter(Boolean).join(" ").trim() || user?.name || "Instructor";

const userSelect = {
  id: true,
  name: true,
  email: true,
  user_info: { select: { first_name: true, last_name: true } },
} as const;

const FLAGS = ["can_grade", "can_attendance", "can_message", "can_edit_curriculum"] as const;
type Flags = Partial<Record<(typeof FLAGS)[number], boolean>>;

const readFlags = (body: Record<string, unknown>): Flags =>
  Object.fromEntries(FLAGS.filter((f) => typeof body[f] === "boolean").map((f) => [f, body[f] as boolean]));

const PENDING = ["SUBMITTED", "RESUBMITTED"] as const;
const GRADING_WINDOW_DAYS = 180;

export class InstructorService {
  async listRoster(programId: number) {
    const [roster, classes] = await Promise.all([
      prisma.program_instructor.findMany({
        where: { programId },
        orderBy: { createdAt: "asc" },
        include: { user: { select: userSelect } },
      }),
      prisma.course.findMany({
        where: { cohort: { programId }, instructorId: { not: null } },
        select: { id: true, name: true, instructorId: true, cohort: { select: { id: true, name: true } }, instructor: { select: userSelect } },
      }),
    ]);

    const rosterIds = new Set(roster.map((r) => r.userId));
    const classesOf = (userId: number) =>
      classes
        .filter((c) => c.instructorId === userId)
        .map((c) => ({ id: c.id, name: c.name, cohortId: c.cohort.id, cohortName: c.cohort.name }));

    // Class instructors not on the roster still teach here, with default abilities.
    const implicit = new Map<number, (typeof classes)[number]["instructor"]>();
    classes.forEach((c) => {
      if (c.instructorId && !rosterIds.has(c.instructorId) && c.instructor) implicit.set(c.instructorId, c.instructor);
    });

    return [
      ...roster.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: personName(r.user),
        email: r.user.email,
        onRoster: true,
        can_grade: r.can_grade,
        can_attendance: r.can_attendance,
        can_message: r.can_message,
        can_edit_curriculum: r.can_edit_curriculum,
        classes: classesOf(r.userId),
      })),
      ...Array.from(implicit.entries()).map(([userId, user]) => ({
        id: null,
        userId,
        name: personName(user),
        email: user?.email ?? null,
        onRoster: false,
        can_grade: true,
        can_attendance: true,
        can_message: true,
        can_edit_curriculum: false,
        classes: classesOf(userId),
      })),
    ];
  }

  async addToRoster(programId: number, userIds: number[], body: Record<string, unknown>, actorUserId: number | null) {
    const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) throw new LmsError("Program not found", 404);
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    if (users.length !== new Set(userIds).size) throw new LmsError("Some people were not found", 404);
    const flags = readFlags(body);
    await prisma.$transaction(
      userIds.map((userId) =>
        prisma.program_instructor.upsert({
          where: { programId_userId: { programId, userId } },
          update: flags,
          create: { programId, userId, added_by: actorUserId, ...flags },
        }),
      ),
    );
    return this.listRoster(programId);
  }

  async updateRoster(id: number, body: Record<string, unknown>) {
    const existing = await prisma.program_instructor.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Instructor not found on this program", 404);
    await prisma.program_instructor.update({ where: { id }, data: readFlags(body) });
    return this.listRoster(existing.programId);
  }

  async removeFromRoster(id: number) {
    const existing = await prisma.program_instructor.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Instructor not found on this program", 404);
    await prisma.program_instructor.delete({ where: { id } });
    return { id };
  }

  /** Every instructor (class instructors and roster members) with workload and grading speed. */
  async overview(branchId?: unknown) {
    const since = new Date(Date.now() - GRADING_WINDOW_DAYS * 86_400_000);
    const branchWhere = getBranchScopedWhere(branchId);
    const [courses, roster, pending, graded] = await Promise.all([
      prisma.course.findMany({
        where: { instructorId: { not: null }, ...(branchWhere ? { cohort: { program: branchWhere } } : {}) },
        select: {
          id: true,
          name: true,
          classFormat: true,
          instructorId: true,
          enrolled: true,
          cohort: { select: { id: true, name: true, status: true, program: { select: { id: true, title: true } } } },
        },
      }),
      prisma.program_instructor.findMany({
        where: branchWhere ? { program: branchWhere } : undefined,
        select: { userId: true, program: { select: { id: true, title: true } } },
      }),
      prisma.assignment_submission.findMany({
        where: {
          status: { in: [...PENDING] },
          enrollment: {
            course: { instructorId: { not: null }, ...(branchWhere ? { cohort: { program: branchWhere } } : {}) },
          },
        },
        select: { enrollment: { select: { course: { select: { instructorId: true } } } } },
      }),
      prisma.assignment_submission.findMany({
        where: {
          gradedById: { not: null },
          gradedAt: { gte: since },
          learningUnit: {
            type: "assignment-essay",
            ...(branchWhere ? { topic: { program: branchWhere } } : {}),
          },
        },
        select: { gradedById: true, submittedAt: true, gradedAt: true },
      }),
    ]);

    const ids = Array.from(
      new Set([...courses.map((c) => c.instructorId as number), ...roster.map((r) => r.userId)]),
    );
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect }) : [];

    return users
      .map((u) => {
        const mine = courses.filter((c) => c.instructorId === u.id);
        const live = mine.filter((c) => c.cohort.status !== "Completed");
        const turnaround = graded
          .filter((g) => g.gradedById === u.id && g.gradedAt)
          .map((g) => (g.gradedAt!.getTime() - g.submittedAt.getTime()) / 3_600_000);
        const programs = new Map<number, string>();
        mine.forEach((c) => programs.set(c.cohort.program.id, c.cohort.program.title));
        roster.filter((r) => r.userId === u.id).forEach((r) => programs.set(r.program.id, r.program.title));
        return {
          userId: u.id,
          name: personName(u),
          email: u.email,
          programs: Array.from(programs.entries()).map(([id, title]) => ({ id, title })),
          classes: mine.map((c) => ({
            id: c.id,
            name: c.name,
            format: c.classFormat,
            cohortId: c.cohort.id,
            cohortName: c.cohort.name,
            programTitle: c.cohort.program.title,
            live: c.cohort.status !== "Completed",
          })),
          liveClasses: live.length,
          learners: live.reduce((s, c) => s + c.enrolled, 0),
          toGrade: pending.filter((p) => p.enrollment.course.instructorId === u.id).length,
          avgGradingHours: turnaround.length
            ? Math.round((turnaround.reduce((a, b) => a + b, 0) / turnaround.length) * 10) / 10
            : null,
          gradedCount: turnaround.length,
          formats: Array.from(new Set(mine.map((c) => c.classFormat).filter(Boolean))),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export const instructorService = new InstructorService();
