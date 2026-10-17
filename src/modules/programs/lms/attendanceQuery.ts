import { prisma } from "../../../Models/context";
import { attendancePercent } from "./gradebookMath";

/**
 * Attendance % per enrollment in a cohort, counting past, non-cancelled sessions
 * where attendance was taken. Cohort-wide sessions count for every class.
 */
export const attendanceByEnrollment = async (cohortId: number) => {
  const [sessions, enrollments] = await Promise.all([
    prisma.lms_session.findMany({
      where: { cohortId, cancelled: false, starts_at: { lte: new Date() }, attendance: { some: {} } },
      select: { id: true, courseId: true },
    }),
    prisma.enrollment.findMany({
      where: { course: { cohortId } },
      select: { id: true, course_id: true, lms_attendance: { select: { sessionId: true, status: true } } },
    }),
  ]);
  const map = new Map<number, number | null>();
  enrollments.forEach((e) => {
    const taken = sessions.filter((s) => s.courseId === null || s.courseId === e.course_id).map((s) => s.id);
    map.set(e.id, attendancePercent(taken, e.lms_attendance));
  });
  return { tracked: sessions.length > 0, map };
};
