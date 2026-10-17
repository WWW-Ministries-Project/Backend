import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { EnrollmentService } from "../enrolmentService";
import { ProgramService } from "../programService";
import { attendanceByEnrollment } from "./attendanceQuery";
import { categoryForUnit, readCompletion, readWeights } from "./curriculumService";
import { dueDateFromRule, parseDueRule } from "./dueRules";
import {
  computeCell,
  rubricPercentage,
  summarizeLearner,
  type Category,
  type GradingMode,
  type RubricCriterion,
  type RubricLevel,
} from "./gradebookMath";
import { LmsError } from "./lmsHttp";

export const QUESTION_TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

export const DEFAULT_RUBRIC_LEVELS: RubricLevel[] = [
  { id: "excellent", label: "Excellent", factor: 1 },
  { id: "good", label: "Good", factor: 0.8 },
  { id: "fair", label: "Fair", factor: 0.6 },
  { id: "poor", label: "Poor", factor: 0.3 },
];

const TRUE_FALSE_OPTIONS = [
  { id: "true", text: "True" },
  { id: "false", text: "False" },
];

const parseJson = (value: unknown): any => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const unitPassMark = (data: unknown) => {
  const parsed = parseJson(data);
  const raw =
    parsed && typeof parsed === "object" ? (parsed.passMark ?? parsed.pass_mark ?? parsed.passmark) : undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 50;
};

const personName = (user: { name: string | null; user_info?: { first_name: string | null; last_name: string | null } | null } | null) =>
  [user?.user_info?.first_name, user?.user_info?.last_name].filter(Boolean).join(" ").trim() ||
  user?.name ||
  "Learner";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean).slice(0, 20) : [];

export class AssessmentService {
  private programs = new ProgramService();
  private enrollments = new EnrollmentService();

  // ---------------------------------------------------------------------------
  // Question bank
  // ---------------------------------------------------------------------------

  private normalizeQuestion(body: Record<string, unknown>) {
    const type = String(body.type ?? "") as QuestionType;
    if (!QUESTION_TYPES.includes(type)) {
      throw new LmsError(`type must be one of ${QUESTION_TYPES.join(", ")}`);
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) throw new LmsError("prompt is required");
    const difficulty = DIFFICULTIES.includes(body.difficulty as (typeof DIFFICULTIES)[number])
      ? (body.difficulty as string)
      : "MEDIUM";

    let options: { id: string; text: string }[] | null = null;
    let correct: string | null = null;
    if (type === "TRUE_FALSE") {
      options = TRUE_FALSE_OPTIONS;
      correct = body.correct_option_id === "false" ? "false" : "true";
    } else if (type === "MULTIPLE_CHOICE") {
      const raw = Array.isArray(body.options) ? body.options : [];
      options = raw
        .map((o: any) => ({ id: String(o?.id || randomUUID()), text: String(o?.text ?? "").trim() }))
        .filter((o) => o.text);
      if (options.length < 2) throw new LmsError("A multiple-choice question needs at least two options");
      correct = String(body.correct_option_id ?? "");
      if (!options.some((o) => o.id === correct)) throw new LmsError("correct_option_id must match one of the options");
    }

    return {
      type,
      prompt,
      difficulty,
      tags: asStringArray(body.tags) as unknown as Prisma.InputJsonValue,
      options: (options ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      correct_option_id: correct,
    };
  }

  async listQuestions(filters: { search?: string; type?: string; tag?: string }) {
    const where: Prisma.lms_questionWhereInput = {};
    if (filters.search) where.prompt = { contains: filters.search };
    if (filters.type && QUESTION_TYPES.includes(filters.type as QuestionType)) where.type = filters.type;
    const tag = filters.tag?.trim().toLowerCase();
    // Tags are JSON; filter them in memory, so only cap the page when not filtering by tag.
    const rows = await prisma.lms_question.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      ...(tag ? {} : { take: 500 }),
    });
    return tag
      ? rows.filter((r) => asStringArray(r.tags).some((t) => t.toLowerCase() === tag))
      : rows;
  }

  async createQuestion(body: Record<string, unknown>, userId: number | null) {
    return prisma.lms_question.create({ data: { ...this.normalizeQuestion(body), created_by: userId } });
  }

  async updateQuestion(id: number, body: Record<string, unknown>) {
    const existing = await prisma.lms_question.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Question not found", 404);
    const merged = {
      type: existing.type,
      prompt: existing.prompt,
      difficulty: existing.difficulty,
      tags: existing.tags,
      options: existing.options,
      correct_option_id: existing.correct_option_id,
      ...body,
    };
    return prisma.lms_question.update({ where: { id }, data: this.normalizeQuestion(merged) });
  }

  async deleteQuestion(id: number) {
    const existing = await prisma.lms_question.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Question not found", 404);
    await prisma.lms_question.delete({ where: { id } });
    return { id };
  }

  /**
   * Copies bank questions into a quiz unit (MCQ learning unit). Copies, not
   * links: later bank edits never change a quiz learners may already have taken.
   */
  async addQuestionsToUnit(topicId: number, questionIds: number[]) {
    const unit = await prisma.learningUnit.findUnique({ where: { topicId } });
    if (!unit || unit.type !== "assignment") throw new LmsError("Questions can only be added to a quiz unit");

    const questions = await prisma.lms_question.findMany({ where: { id: { in: questionIds } } });
    const usable = questions.filter((q) => q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE");
    if (!usable.length) {
      throw new LmsError("Only multiple-choice and true/false questions can be added to a quiz");
    }

    const data = parseJson(unit.data);
    const current = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const existing: any[] = Array.isArray(current.questions) ? current.questions : [];
    const alreadyIn = new Set(existing.map((q) => Number(q?.bankQuestionId)).filter(Boolean));

    const additions = usable
      .filter((q) => !alreadyIn.has(q.id))
      .map((q) => {
        const optionIdMap = new Map<string, string>();
        const options = (Array.isArray(q.options) ? (q.options as { id: string; text: string }[]) : []).map((o) => {
          const id = randomUUID();
          optionIdMap.set(o.id, id);
          return { id, text: o.text };
        });
        return {
          id: randomUUID(),
          question: q.prompt,
          options,
          correctOptionId: q.correct_option_id ? (optionIdMap.get(q.correct_option_id) ?? null) : null,
          bankQuestionId: q.id,
        };
      });

    const written = await prisma.learningUnit.updateMany({
      where: { id: unit.id, version: unit.version },
      data: {
        data: JSON.stringify({ ...current, questions: [...existing, ...additions] }),
        version: { increment: 1 },
      },
    });
    if (written.count === 0) {
      throw new LmsError("This quiz was changed by someone else. Reload and try again.", 409);
    }
    return { added: additions.length, skipped: usable.length - additions.length, total: existing.length + additions.length };
  }

  // ---------------------------------------------------------------------------
  // Rubrics
  // ---------------------------------------------------------------------------

  private normalizeRubric(body: Record<string, unknown>) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw new LmsError("title is required");
    const criteria: RubricCriterion[] = (Array.isArray(body.criteria) ? body.criteria : [])
      .map((c: any) => ({
        id: String(c?.id || randomUUID()),
        label: String(c?.label ?? "").trim(),
        weight: Number(c?.weight),
      }))
      .filter((c) => c.label);
    if (!criteria.length) throw new LmsError("Add at least one criterion");
    if (criteria.some((c) => !Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100)) {
      throw new LmsError("Criterion weights must be whole numbers from 0 to 100");
    }
    const total = criteria.reduce((s, c) => s + c.weight, 0);
    if (total !== 100) throw new LmsError(`Criterion weights must total 100 (currently ${total})`);

    const rawLevels = Array.isArray(body.levels) && body.levels.length ? body.levels : DEFAULT_RUBRIC_LEVELS;
    const levels: RubricLevel[] = rawLevels
      .map((l: any) => ({
        id: String(l?.id || randomUUID()),
        label: String(l?.label ?? "").trim(),
        factor: Number(l?.factor),
      }))
      .filter((l) => l.label);
    if (levels.length < 2 || levels.some((l) => !(l.factor >= 0 && l.factor <= 1))) {
      throw new LmsError("A rubric needs at least two levels, each with a factor between 0 and 1");
    }
    return {
      title,
      criteria: criteria as unknown as Prisma.InputJsonValue,
      levels: levels as unknown as Prisma.InputJsonValue,
    };
  }

  async listRubrics() {
    const rubrics = await prisma.lms_rubric.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { units: true } } },
    });
    return rubrics.map(({ _count, ...r }) => ({ ...r, usedBy: _count.units }));
  }

  async createRubric(body: Record<string, unknown>, userId: number | null) {
    return prisma.lms_rubric.create({ data: { ...this.normalizeRubric(body), created_by: userId } });
  }

  async updateRubric(id: number, body: Record<string, unknown>) {
    const existing = await prisma.lms_rubric.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Rubric not found", 404);
    return prisma.lms_rubric.update({
      where: { id },
      data: this.normalizeRubric({ title: existing.title, criteria: existing.criteria, levels: existing.levels, ...body }),
    });
  }

  async deleteRubric(id: number) {
    const existing = await prisma.lms_rubric.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Rubric not found", 404);
    await prisma.lms_rubric.delete({ where: { id } });
    return { id };
  }

  async setUnitRubric(topicId: number, rubricId: number | null) {
    const unit = await prisma.learningUnit.findUnique({ where: { topicId } });
    if (!unit || unit.type !== "assignment-essay") throw new LmsError("Rubrics can only be attached to essay units");
    if (rubricId !== null) {
      const rubric = await prisma.lms_rubric.findUnique({ where: { id: rubricId }, select: { id: true } });
      if (!rubric) throw new LmsError("Rubric not found", 404);
    }
    return prisma.learningUnit.update({
      where: { id: unit.id },
      data: { rubricId },
      select: { id: true, topicId: true, rubricId: true },
    });
  }

  /** Grades an essay with its unit's rubric; the result goes through the normal grade path. */
  async gradeWithRubric(args: {
    submissionId: number;
    scores: Record<string, string>;
    feedback: string | null;
    actorUserId: number | null;
  }) {
    const submission = await prisma.assignment_submission.findUnique({
      where: { id: args.submissionId },
      select: { id: true, learningUnit: { select: { rubric: true } } },
    });
    if (!submission) throw new LmsError("Submission not found", 404);
    const rubric = submission.learningUnit.rubric;
    if (!rubric) throw new LmsError("This unit has no rubric attached");

    let grade: number;
    try {
      grade = rubricPercentage(
        rubric.criteria as unknown as RubricCriterion[],
        rubric.levels as unknown as RubricLevel[],
        args.scores,
      );
    } catch (error: any) {
      throw new LmsError(error.message);
    }

    // Store the rubric choice first: if grading then fails, a retry simply re-grades.
    await prisma.assignment_submission.update({
      where: { id: args.submissionId },
      data: { rubric_scores: args.scores as unknown as Prisma.InputJsonValue },
    });
    const result = await this.programs.gradeAssignmentSubmission({
      submissionId: args.submissionId,
      grade,
      feedback: args.feedback,
      actorUserId: args.actorUserId,
    });
    return { ...result, rubricScores: args.scores };
  }

  /** Essay submission with its rubric, for the grading drawer. */
  async getSubmissionForGrading(submissionId: number) {
    const submission = await prisma.assignment_submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        attempt: true,
        status: true,
        submittedAt: true,
        fileUrl: true,
        content: true,
        score: true,
        feedback: true,
        rubric_scores: true,
        enrollment: {
          select: {
            id: true,
            user: { select: { name: true, user_info: { select: { first_name: true, last_name: true } } } },
            course: { select: { name: true } },
          },
        },
        learningUnit: {
          select: { id: true, type: true, data: true, topic: { select: { id: true, name: true } }, rubric: true },
        },
      },
    });
    if (!submission) throw new LmsError("Submission not found", 404);
    const data = parseJson(submission.learningUnit.data);
    return {
      id: submission.id,
      attempt: submission.attempt,
      status: submission.status,
      submittedAt: submission.submittedAt,
      fileUrl: submission.fileUrl,
      content: submission.learningUnit.type === "assignment-essay" ? submission.content : null,
      score: submission.score,
      feedback: submission.feedback,
      rubricScores: submission.rubric_scores,
      learnerName: personName(submission.enrollment.user),
      className: submission.enrollment.course.name,
      enrollmentId: submission.enrollment.id,
      unit: {
        id: submission.learningUnit.id,
        type: submission.learningUnit.type,
        topicId: submission.learningUnit.topic.id,
        name: submission.learningUnit.topic.name,
        prompt: data && typeof data === "object" ? (data.question ?? null) : null,
        passMark: unitPassMark(submission.learningUnit.data),
      },
      rubric: submission.learningUnit.rubric,
    };
  }

  // ---------------------------------------------------------------------------
  // Gradebook
  // ---------------------------------------------------------------------------

  async getGradebook(cohortId: number, courseId: number | null) {
    const { tracked: attendanceTracked, map: attendance } = await attendanceByEnrollment(cohortId);
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: {
        id: true,
        name: true,
        startDate: true,
        program: {
          select: {
            id: true,
            title: true,
            grading_mode: true,
            pass_mark: true,
            grading_weights: true,
            completion_rules: true,
            topics: {
              orderBy: [{ order_number: "asc" }, { id: "asc" }],
              select: {
                id: true,
                name: true,
                moduleId: true,
                LearningUnit: {
                  select: {
                    id: true,
                    type: true,
                    data: true,
                    due_rule: true,
                    grading_category: true,
                    rubricId: true,
                    cohortAssignments: { where: { cohortId }, select: { dueDate: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
        courses: {
          where: courseId ? { id: courseId } : undefined,
          select: {
            id: true,
            name: true,
            classFormat: true,
            enrollments: {
              select: {
                id: true,
                user_id: true,
                completed: true,
                user: { select: { name: true, user_info: { select: { first_name: true, last_name: true } } } },
                progress: { select: { topicId: true, score: true, status: true, completed: true } },
                submissions: {
                  orderBy: [{ submittedAt: "desc" }, { attempt: "desc" }],
                  select: { id: true, learningUnitId: true, status: true, attempt: true },
                },
                extensions: { select: { learningUnitId: true, dueDate: true } },
                gradeOverrides: { select: { learningUnitId: true, score: true, excused: true, note: true } },
              },
            },
          },
        },
      },
    });
    if (!cohort) throw new LmsError("Cohort not found", 404);

    const program = cohort.program;
    const mode = (program.grading_mode === "WEIGHTED" ? "WEIGHTED" : "PASS_FAIL") as GradingMode;
    const weights = readWeights(program.grading_weights);
    const completion = readCompletion(program.completion_rules);
    const now = new Date();

    const columns = program.topics
      .filter((t) => t.LearningUnit && t.LearningUnit.type.startsWith("assignment"))
      .map((t) => {
        const unit = t.LearningUnit!;
        const assignment = unit.cohortAssignments[0];
        return {
          topicId: t.id,
          learningUnitId: unit.id,
          name: t.name,
          moduleId: t.moduleId,
          type: unit.type,
          category: categoryForUnit(unit) as Category | null,
          passMark: unitPassMark(unit.data),
          hasRubric: Boolean(unit.rubricId),
          isActive: assignment?.isActive ?? false,
          dueDate: assignment?.dueDate ?? dueDateFromRule(cohort.startDate, parseDueRule(unit.due_rule)),
        };
      });

    const rows = cohort.courses.flatMap((course) =>
      course.enrollments.map((enrollment) => {
        const cells = columns.map((col) => {
          const extension = enrollment.extensions.find((x) => x.learningUnitId === col.learningUnitId);
          const override = enrollment.gradeOverrides.find((o) => o.learningUnitId === col.learningUnitId) ?? null;
          const latestSubmission = enrollment.submissions.find((s) => s.learningUnitId === col.learningUnitId) ?? null;
          const progress = enrollment.progress.find((p) => p.topicId === col.topicId) ?? null;
          const cell = computeCell(
            {
              unitPassMark: col.passMark,
              dueDate: extension?.dueDate ?? col.dueDate,
              progress,
              latestSubmission,
              override,
            },
            now,
          );
          return { topicId: col.topicId, ...cell, note: override?.note ?? null, extendedTo: extension?.dueDate ?? null };
        });

        const att = attendance.get(enrollment.id) ?? null;
        const summary = summarizeLearner({
          mode,
          passMark: program.pass_mark,
          weights,
          minAttendance: completion.minAttendance,
          cells: cells.map((c, i) => ({ category: columns[i].category, cell: c })),
          attendance: att,
          completed: Boolean(enrollment.completed),
        });

        return {
          enrollmentId: enrollment.id,
          userId: enrollment.user_id,
          name: personName(enrollment.user),
          classId: course.id,
          className: course.name,
          classFormat: course.classFormat,
          attendance: att,
          cells,
          ...summary,
        };
      }),
    );

    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      cohort: { id: cohort.id, name: cohort.name, startDate: cohort.startDate },
      program: { id: program.id, title: program.title },
      grading: {
        mode,
        passMark: program.pass_mark,
        weights,
        completion,
        // False until attendance is taken for a session; until then the attendance weight is left out.
        attendanceTracked,
      },
      columns,
      rows,
      totals: {
        learners: rows.length,
        atRisk: rows.filter((r) => r.status === "At risk").length,
        needsGrading: rows.reduce((s, r) => s + r.needsGrading, 0),
        missing: rows.reduce((s, r) => s + r.missing, 0),
      },
    };
  }

  /**
   * Sets or clears a gradebook override for one or more learners on one unit.
   * A score (or an excusal) is mirrored into `progress` so completion and
   * certificate eligibility follow the gradebook.
   */
  async setOverrides(args: {
    topicId: number;
    enrollmentIds: number[];
    score: number | null;
    excused: boolean;
    clear: boolean;
    note: string | null;
    userId: number | null;
  }) {
    const unit = await prisma.learningUnit.findUnique({
      where: { topicId: args.topicId },
      select: { id: true, type: true, data: true, topic: { select: { programId: true } } },
    });
    if (!unit || !unit.type.startsWith("assignment")) throw new LmsError("Only quiz and essay units can be overridden");
    if (!args.clear && !args.excused && (args.score === null || args.score < 0 || args.score > 100)) {
      throw new LmsError("score must be from 0 to 100, or set excused");
    }

    // Only learners enrolled in this unit's program.
    const valid = await prisma.enrollment.findMany({
      where: { id: { in: args.enrollmentIds }, course: { cohort: { programId: unit.topic.programId } } },
      select: { id: true },
    });
    if (valid.length !== args.enrollmentIds.length) {
      throw new LmsError("Some learners are not enrolled in this program");
    }

    const passMark = unitPassMark(unit.data);
    const now = new Date();

    await prisma.$transaction(
      async (tx) => {
        for (const enrollmentId of args.enrollmentIds) {
          const progressKey = { enrollmentId_topicId: { enrollmentId, topicId: args.topicId } };
          const overrideKey = { enrollmentId_learningUnitId: { enrollmentId, learningUnitId: unit.id } };
          const existing = await tx.lms_grade_override.findUnique({ where: overrideKey });

          if (args.clear) {
            if (!existing) continue;
            await tx.lms_grade_override.delete({ where: overrideKey });
            // Put back exactly what the learner had before staff stepped in.
            const prev = existing.prev_progress as
              | { score: number; status: "PASS" | "FAIL" | "PENDING"; completed: boolean | null; completedAt: string | null; notes: string | null }
              | null;
            if (prev) {
              await tx.progress.update({
                where: progressKey,
                data: {
                  score: prev.score,
                  status: prev.status,
                  completed: prev.completed,
                  completedAt: prev.completedAt ? new Date(prev.completedAt) : null,
                  notes: prev.notes,
                },
              });
            } else {
              await tx.progress.deleteMany({ where: { enrollmentId, topicId: args.topicId } });
            }
            continue;
          }

          // Snapshot the learner's own progress only on the first override.
          let prevProgress: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
          if (!existing) {
            const current = await tx.progress.findUnique({
              where: progressKey,
              select: { score: true, status: true, completed: true, completedAt: true, notes: true },
            });
            prevProgress = current
              ? ({ ...current, completedAt: current.completedAt?.toISOString() ?? null } as Prisma.InputJsonValue)
              : Prisma.DbNull;
          }

          const fields = {
            score: args.excused ? null : args.score,
            excused: args.excused,
            note: args.note,
            updated_by: args.userId,
          };
          await tx.lms_grade_override.upsert({
            where: overrideKey,
            update: fields,
            create: { enrollmentId, learningUnitId: unit.id, ...fields, prev_progress: prevProgress ?? Prisma.DbNull },
          });

          // Excused counts as passed so it never blocks completion or a certificate.
          const score = args.excused ? 0 : (args.score as number);
          const status = args.excused || score >= passMark ? "PASS" : "FAIL";
          const notes = args.excused ? "Excused" : args.note;
          await tx.progress.upsert({
            where: progressKey,
            update: { score, status, completed: true, completedAt: now, notes },
            create: { enrollmentId, topicId: args.topicId, score, status, completed: true, completedAt: now, notes },
          });
        }
      },
      { timeout: 30000 },
    );
    return { updated: args.enrollmentIds.length };
  }

  // ---------------------------------------------------------------------------
  // Certificates (design and PDF stay in certificatePdfService)
  // ---------------------------------------------------------------------------

  async listCertificates(programId: number) {
    const [program, issued, enrollments] = await Promise.all([
      prisma.program.findUnique({ where: { id: programId }, select: { id: true, topics: { select: { id: true } } } }),
      prisma.certificate.findMany({
        where: { programId },
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          certificateNumber: true,
          issuedAt: true,
          user: { select: { id: true, name: true, user_info: { select: { first_name: true, last_name: true } } } },
        },
      }),
      prisma.enrollment.findMany({
        where: { course: { cohort: { programId } } },
        orderBy: { id: "asc" },
        select: {
          user_id: true,
          user: { select: { name: true, user_info: { select: { first_name: true, last_name: true } } } },
          course: { select: { name: true, cohort: { select: { name: true } } } },
          progress: { where: { status: "PASS" }, select: { topicId: true } },
        },
      }),
    ]);
    if (!program) throw new LmsError("Program not found", 404);

    const topicIds = new Set(program.topics.map((t) => t.id));
    const issuedUserIds = new Set(issued.map((c) => c.user.id));
    const eligible = new Map<number, { userId: number; name: string; cohort: string; className: string }>();
    // Issuing checks the user's first enrollment in the program (findFirst), so judge that one only.
    const seen = new Set<number>();
    for (const e of enrollments) {
      if (!e.user_id || seen.has(e.user_id)) continue;
      seen.add(e.user_id);
      if (issuedUserIds.has(e.user_id) || !topicIds.size) continue;
      const passed = new Set(e.progress.map((p) => p.topicId).filter((id) => topicIds.has(id)));
      if (passed.size === topicIds.size) {
        eligible.set(e.user_id, {
          userId: e.user_id,
          name: personName(e.user),
          cohort: e.course.cohort.name,
          className: e.course.name,
        });
      }
    }

    return {
      issued: issued.map((c) => ({
        id: c.id,
        certificateNumber: c.certificateNumber,
        issuedAt: c.issuedAt,
        userId: c.user.id,
        name: personName(c.user),
      })),
      eligible: Array.from(eligible.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Issues through the same path learners use, so numbering and design are unchanged. */
  async issueCertificates(programId: number, userIds: number[]) {
    const results: { userId: number; ok: boolean; certificateNumber?: string; error?: string }[] = [];
    for (const userId of userIds) {
      try {
        const cert = await this.enrollments.getProgramCertificate(programId, userId);
        results.push({ userId, ok: true, certificateNumber: cert.certificateNumber });
      } catch (error: any) {
        results.push({ userId, ok: false, error: error?.message ?? "Could not issue" });
      }
    }
    return { issued: results.filter((r) => r.ok).length, results };
  }
}

export const assessmentService = new AssessmentService();
