import { prisma } from "../../../Models/context";
import { getBranchScopedWhere } from "../../branches/branchService";
import { categoryForUnit } from "./curriculumService";

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** School of Ministry reports for the admin Reports page. */
export class ReportsService {
  async summary(filters: { branchId?: unknown; from?: Date; to?: Date }) {
    const programWhere = getBranchScopedWhere(filters.branchId) ?? {};
    const programs = await prisma.program.findMany({
      where: programWhere,
      select: { id: true, title: true, topics: { select: { id: true } } },
    });
    const programIds = programs.map((p) => p.id);
    const enrolledAt = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;

    const [enrollments, attendance, assessed, graded] = await Promise.all([
      prisma.enrollment.findMany({
        where: { course: { cohort: { programId: { in: programIds } } }, ...(enrolledAt ? { enrolledAt } : {}) },
        select: {
          enrolledAt: true,
          completed: true,
          course: { select: { cohort: { select: { programId: true } } } },
          progress: { where: { status: "PASS" }, select: { topicId: true } },
        },
      }),
      prisma.lms_attendance.findMany({
        where: { session: { cancelled: false, cohort: { programId: { in: programIds } } } },
        select: { status: true, session: { select: { mode: true } } },
      }),
      prisma.progress.findMany({
        where: {
          completed: true,
          status: { in: ["PASS", "FAIL"] },
          topic: { programId: { in: programIds }, LearningUnit: { type: { startsWith: "assignment" } } },
        },
        select: { status: true, topic: { select: { LearningUnit: { select: { type: true, grading_category: true } } } } },
      }),
      prisma.assignment_submission.findMany({
        where: {
          gradedById: { not: null },
          gradedAt: { not: null },
          learningUnit: { type: "assignment-essay", topic: { programId: { in: programIds } } },
        },
        select: { submittedAt: true, gradedAt: true },
      }),
    ]);

    const completionByProgram = programs
      .map((p) => {
        const mine = enrollments.filter((e) => e.course.cohort.programId === p.id);
        const topicIds = new Set(p.topics.map((t) => t.id));
        const done = mine.filter(
          (e) => e.completed || (topicIds.size > 0 && e.progress.filter((x) => topicIds.has(x.topicId)).length >= topicIds.size),
        ).length;
        return { programId: p.id, title: p.title, enrolled: mine.length, completed: done, rate: pct(done, mine.length) };
      })
      .filter((r) => r.enrolled > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

    const modes = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
    const attendanceByMode = modes.map((mode) => {
      const rows = attendance.filter((a) => a.session.mode === mode && a.status !== "EXCUSED");
      const attended = rows.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
      return { mode, records: rows.length, rate: pct(attended, rows.length) };
    });

    const categories = ["quiz", "essay", "exam"] as const;
    const passRateByType = categories.map((category) => {
      const rows = assessed.filter((a) => a.topic.LearningUnit && categoryForUnit(a.topic.LearningUnit) === category);
      const passed = rows.filter((r) => r.status === "PASS").length;
      return { category, graded: rows.length, rate: pct(passed, rows.length) };
    });

    const hours = graded.map((g) => (g.gradedAt!.getTime() - g.submittedAt.getTime()) / 3_600_000);
    const sortedHours = [...hours].sort((a, b) => a - b);
    const gradingTurnaround = {
      graded: hours.length,
      avgHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      medianHours: sortedHours.length ? Math.round(sortedHours[Math.floor(sortedHours.length / 2)] * 10) / 10 : null,
      within4Days: pct(hours.filter((h) => h <= 96).length, hours.length),
    };

    const byMonth = new Map<string, number>();
    enrollments.forEach((e) => {
      const key = `${e.enrolledAt.getUTCFullYear()}-${String(e.enrolledAt.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    });
    const enrollmentsByMonth = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, count]) => ({ month, count }));

    return {
      totals: {
        programs: programs.length,
        enrollments: enrollments.length,
        completed: completionByProgram.reduce((s, r) => s + r.completed, 0),
      },
      completionByProgram,
      attendanceByMode,
      passRateByType,
      gradingTurnaround,
      enrollmentsByMonth,
    };
  }
}

export const reportsService = new ReportsService();
