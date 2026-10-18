import { prisma } from "../../../Models/context";
import { assessmentService } from "./assessmentService";
import { readWeights } from "./curriculumService";
import { rubricPercentage, type RubricCriterion, type RubricLevel } from "./gradebookMath";
import { LmsError } from "./lmsHttp";

/**
 * Read models for the member-facing learner portal. Everything is scoped to
 * the signed-in user's own enrollments; grades come from the same gradebook
 * the instructors see, so the two can never disagree.
 */

const personName = (user: { name: string | null; user_info?: { first_name: string | null; last_name: string | null } | null } | null) =>
  [user?.user_info?.first_name, user?.user_info?.last_name].filter(Boolean).join(" ").trim() || user?.name || null;

const userSelect = { id: true, name: true, user_info: { select: { first_name: true, last_name: true } } } as const;

const parseJson = (value: unknown): any => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const myEnrollments = (userId: number) =>
  prisma.enrollment.findMany({
    where: { user_id: userId },
    orderBy: { enrolledAt: "desc" },
    select: {
      id: true,
      enrolledAt: true,
      completed: true,
      completedAt: true,
      course_id: true,
      progress: { select: { topicId: true, completed: true } },
      course: {
        select: {
          id: true,
          name: true,
          classFormat: true,
          schedule: true,
          location: true,
          meetingLink: true,
          instructor: { select: userSelect },
          cohort: {
            select: {
              id: true,
              name: true,
              startDate: true,
              duration: true,
              status: true,
              program: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  grading_mode: true,
                  pass_mark: true,
                  grading_weights: true,
                  modules: { select: { id: true, title: true, order_number: true } },
                  topics: {
                    orderBy: [{ order_number: "asc" }, { id: "asc" }],
                    select: { id: true, name: true, moduleId: true, LearningUnit: { select: { type: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

export class LearnerService {
  /**
   * Every enrollment of the user with progress, the next unit to work on, the
   * grade summary and one row per assessed unit (status, due date, score).
   */
  async overview(userId: number) {
    const enrollments = await myEnrollments(userId);

    const [feedback, gradebooks] = await Promise.all([
      prisma.assignment_submission.findMany({
        where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
        orderBy: [{ submittedAt: "desc" }, { attempt: "desc" }],
        select: { id: true, feedback: true, gradedAt: true },
      }),
      Promise.all(
        enrollments.map((e) => assessmentService.getGradebook(e.course.cohort.id, e.course.id).catch(() => null)),
      ),
    ]);
    const feedbackById = new Map(feedback.map((f) => [f.id, f]));

    return enrollments.map((enrollment, index) => {
      const { course } = enrollment;
      const { cohort } = course;
      const { program } = cohort;
      const moduleTitle = new Map(program.modules.map((m) => [m.id, m.title]));
      const done = new Set(enrollment.progress.filter((p) => p.completed).map((p) => p.topicId));
      const total = program.topics.length;
      const completedCount = program.topics.filter((t) => done.has(t.id)).length;
      const next = program.topics.find((t) => !done.has(t.id)) ?? null;

      const book = gradebooks[index];
      const row = book?.rows.find((r) => r.enrollmentId === enrollment.id) ?? null;
      const weights = readWeights(program.grading_weights);

      const assessments = (book?.columns ?? []).map((col, i) => {
        const cell = row?.cells[i] ?? null;
        const sub = cell?.submissionId ? feedbackById.get(cell.submissionId) : undefined;
        return {
          topicId: col.topicId,
          name: col.name,
          type: col.type,
          category: col.category,
          moduleTitle: col.moduleId ? (moduleTitle.get(col.moduleId) ?? null) : null,
          passMark: col.passMark,
          isActive: col.isActive,
          dueDate: cell?.extendedTo ?? col.dueDate,
          status: cell?.status ?? "open",
          score: cell?.score ?? null,
          passed: cell?.passed ?? null,
          submissionId: cell?.submissionId ?? null,
          feedback: sub?.feedback ?? cell?.note ?? null,
          gradedAt: sub?.gradedAt ?? null,
        };
      });

      return {
        enrollmentId: enrollment.id,
        enrolledAt: enrollment.enrolledAt,
        completed: Boolean(enrollment.completed),
        completedAt: enrollment.completedAt,
        program: { id: program.id, title: program.title, description: program.description },
        cohort: { id: cohort.id, name: cohort.name, startDate: cohort.startDate, duration: cohort.duration, status: cohort.status },
        class: {
          id: course.id,
          name: course.name,
          format: course.classFormat,
          schedule: course.schedule,
          location: course.location,
          meetingLink: course.meetingLink,
          instructor: course.instructor ? { id: course.instructor.id, name: personName(course.instructor) } : null,
        },
        progress: {
          completed: completedCount,
          total,
          percent: total ? Math.round((completedCount / total) * 100) : 0,
        },
        nextTopic: next
          ? {
              id: next.id,
              name: next.name,
              type: next.LearningUnit?.type ?? null,
              moduleTitle: next.moduleId ? (moduleTitle.get(next.moduleId) ?? null) : null,
            }
          : null,
        grading: { mode: book?.grading.mode ?? program.grading_mode, passMark: program.pass_mark, weights },
        finalGrade: row?.finalGrade ?? null,
        standing: row?.status ?? null,
        attendance: row?.attendance ?? null,
        assessments,
      };
    });
  }

  /** Upcoming and recent sessions for the user's classes, with their own attendance mark. */
  async sessions(userId: number, from: Date | null) {
    const enrollments = await prisma.enrollment.findMany({
      where: { user_id: userId, completed: { not: true } },
      select: {
        id: true,
        course_id: true,
        course: { select: { name: true, cohortId: true, cohort: { select: { name: true, program: { select: { title: true } } } } } },
      },
    });
    if (!enrollments.length) return [];

    const sessions = await prisma.lms_session.findMany({
      where: {
        OR: enrollments.map((e) => ({
          cohortId: e.course.cohortId,
          OR: [{ courseId: null }, { courseId: e.course_id }],
        })),
        ...(from ? { starts_at: { gte: from } } : {}),
      },
      orderBy: { starts_at: "asc" },
      take: 200,
      include: {
        attendance: {
          where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
          select: { status: true },
        },
      },
    });

    const instructorIds = await prisma.course.findMany({
      where: { id: { in: enrollments.map((e) => e.course_id) } },
      select: { id: true, instructor: { select: userSelect } },
    });
    const instructorByCourse = new Map(instructorIds.map((c) => [c.id, personName(c.instructor)]));

    return sessions.map((s) => {
      const enrollment = enrollments.find(
        (e) => e.course.cohortId === s.cohortId && (s.courseId === null || s.courseId === e.course_id),
      )!;
      return {
        id: s.id,
        title: s.title,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        mode: s.mode,
        location: s.location,
        meetingLink: s.meeting_link,
        week: s.week,
        cancelled: s.cancelled,
        notes: s.notes,
        programTitle: enrollment.course.cohort.program.title,
        cohortName: enrollment.course.cohort.name,
        className: s.courseId ? enrollment.course.name : null,
        instructorName: instructorByCourse.get(enrollment.course_id) ?? null,
        attendance: s.attendance[0]?.status ?? null,
      };
    });
  }

  /**
   * Announcements sent to the user's cohorts or classes. "At risk" messages
   * are left out: their recipients are resolved at send time and not stored.
   */
  async announcements(userId: number) {
    const enrollments = await prisma.enrollment.findMany({
      where: { user_id: userId },
      select: { course_id: true, course: { select: { cohortId: true } } },
    });
    if (!enrollments.length) return [];

    const now = new Date();
    const rows = await prisma.lms_announcement.findMany({
      where: {
        AND: [
          {
            OR: enrollments.flatMap((e) => [
              { cohortId: e.course.cohortId, audience: "COHORT" },
              { cohortId: e.course.cohortId, audience: "CLASS", courseId: e.course_id },
            ]),
          },
          { OR: [{ scheduled_for: null }, { scheduled_for: { lte: now } }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        audience: true,
        createdAt: true,
        scheduled_for: true,
        sent_by: true,
        course: { select: { name: true } },
        cohort: { select: { name: true, program: { select: { title: true } } } },
      },
    });

    const senders = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.sent_by).filter((id): id is number => typeof id === "number") } },
      select: userSelect,
    });
    const senderName = new Map(senders.map((u) => [u.id, personName(u)]));

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      audience: r.audience,
      sentAt: r.scheduled_for ?? r.createdAt,
      sentByName: r.sent_by ? (senderName.get(r.sent_by) ?? null) : null,
      programTitle: r.cohort.program.title,
      cohortName: r.cohort.name,
      className: r.course?.name ?? null,
    }));
  }

  /**
   * The user's latest submission for one assessed unit, with feedback and the
   * rubric breakdown. Quiz answers show which were wrong; the correct option is
   * only revealed once the learner passed or has no attempts left.
   */
  async submission(userId: number, topicId: number) {
    const unit = await prisma.learningUnit.findUnique({
      where: { topicId },
      select: {
        id: true,
        type: true,
        data: true,
        maxAttempts: true,
        rubric: true,
        topic: { select: { id: true, name: true, programId: true, module: { select: { title: true } } } },
      },
    });
    if (!unit || !unit.type.startsWith("assignment")) throw new LmsError("Assignment not found", 404);

    const enrollment = await prisma.enrollment.findFirst({
      where: { user_id: userId, course: { cohort: { programId: unit.topic.programId } } },
      orderBy: { enrolledAt: "desc" },
      select: { id: true, progress: { where: { topicId }, select: { score: true, status: true } } },
    });
    if (!enrollment) throw new LmsError("You are not enrolled in this program", 403);

    const submissions = await prisma.assignment_submission.findMany({
      where: { enrollmentId: enrollment.id, learningUnitId: unit.id },
      orderBy: [{ submittedAt: "desc" }, { attempt: "desc" }],
      select: {
        id: true,
        attempt: true,
        status: true,
        submittedAt: true,
        content: true,
        fileUrl: true,
        score: true,
        feedback: true,
        gradedAt: true,
        rubric_scores: true,
        gradedBy: { select: userSelect },
      },
    });
    const latest = submissions[0] ?? null;
    const data = parseJson(unit.data) ?? {};
    const progress = enrollment.progress[0] ?? null;
    const attemptsUsed = submissions.length;
    const maxAttempts = unit.maxAttempts ?? null;
    const passed = progress?.status === "PASS";
    const revealAnswers = passed || (maxAttempts !== null && attemptsUsed >= maxAttempts);

    let quiz: { prompt: string; yours: string | null; correct: string | null; isCorrect: boolean }[] | null = null;
    if (unit.type === "assignment" && latest) {
      const answers = (parseJson(latest.content) ?? {}) as Record<string, string>;
      quiz = asArray<any>(data.questions).map((q) => {
        const options = asArray<any>(q.options);
        const optionText = (id: unknown) => {
          const match = options.find((o) => String(o?.id) === String(id));
          return match ? String(match.text ?? match.label ?? match.id) : null;
        };
        const yours = answers[q.id];
        return {
          prompt: String(q.question ?? q.prompt ?? q.text ?? ""),
          yours: yours ? optionText(yours) : null,
          correct: revealAnswers ? optionText(q.correctOptionId) : null,
          isCorrect: Boolean(yours) && yours === q.correctOptionId,
        };
      });
    }

    let rubric: { label: string; level: string | null; factor: number | null; weight: number }[] | null = null;
    let rubricScore: number | null = null;
    if (unit.rubric && latest?.rubric_scores && typeof latest.rubric_scores === "object") {
      const criteria = asArray<RubricCriterion>(unit.rubric.criteria);
      const levels = asArray<RubricLevel>(unit.rubric.levels);
      const scores = latest.rubric_scores as Record<string, string>;
      rubric = criteria.map((c) => {
        const level = levels.find((l) => l.id === scores[c.id]);
        return { label: c.label, weight: c.weight, level: level?.label ?? null, factor: level?.factor ?? null };
      });
      try {
        rubricScore = rubricPercentage(criteria, levels, scores);
      } catch {
        rubricScore = null;
      }
    }

    return {
      topicId: unit.topic.id,
      programId: unit.topic.programId,
      name: unit.topic.name,
      moduleTitle: unit.topic.module?.title ?? null,
      type: unit.type,
      prompt: typeof data.question === "string" ? data.question : null,
      maxAttempts,
      attemptsUsed,
      progress: progress ? { score: progress.score, status: progress.status } : null,
      submission: latest
        ? {
            id: latest.id,
            attempt: latest.attempt,
            status: latest.status,
            submittedAt: latest.submittedAt,
            fileUrl: latest.fileUrl,
            score: latest.score,
            feedback: latest.feedback,
            gradedAt: latest.gradedAt,
            gradedByName: personName(latest.gradedBy),
          }
        : null,
      quiz,
      rubric,
      rubricScore,
    };
  }
}

export const learnerService = new LearnerService();
