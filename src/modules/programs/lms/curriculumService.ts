import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { describeDueRule, dueDateFromRule, parseDueRule } from "./dueRules";
import { LmsError } from "./lmsHttp";

export const GRADING_MODES = ["PASS_FAIL", "WEIGHTED"] as const;
export type GradingMode = (typeof GRADING_MODES)[number];

export type GradingWeights = { quiz: number; essay: number; exam: number; attendance: number };
export type CompletionRules = {
  requireGrade: boolean;
  requireAllUnits: boolean;
  /** Minimum attendance % (0–100), or null when attendance is not required. */
  minAttendance: number | null;
};

export const DEFAULT_WEIGHTS: GradingWeights = { quiz: 30, essay: 40, exam: 20, attendance: 10 };
export const DEFAULT_COMPLETION: CompletionRules = {
  requireGrade: true,
  requireAllUnits: true,
  minAttendance: null,
};

export const UNIT_CATEGORIES = ["quiz", "essay", "exam"] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export const categoryForUnit = (unit: { type: string; grading_category: string | null }): UnitCategory | null => {
  if (UNIT_CATEGORIES.includes(unit.grading_category as UnitCategory)) {
    return unit.grading_category as UnitCategory;
  }
  if (unit.type === "assignment") return "quiz";
  if (unit.type === "assignment-essay") return "essay";
  return null;
};

const pct = (value: unknown, field: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new LmsError(`${field} must be a whole number from 0 to 100`);
  return n;
};

export const readWeights = (value: Prisma.JsonValue | null | undefined): GradingWeights => {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const num = (k: keyof GradingWeights) => (Number.isFinite(Number(raw[k])) ? Number(raw[k]) : DEFAULT_WEIGHTS[k]);
  return { quiz: num("quiz"), essay: num("essay"), exam: num("exam"), attendance: num("attendance") };
};

export const readCompletion = (value: Prisma.JsonValue | null | undefined): CompletionRules => {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const min = raw.minAttendance;
  return {
    requireGrade: typeof raw.requireGrade === "boolean" ? raw.requireGrade : DEFAULT_COMPLETION.requireGrade,
    requireAllUnits:
      typeof raw.requireAllUnits === "boolean" ? raw.requireAllUnits : DEFAULT_COMPLETION.requireAllUnits,
    minAttendance: min === null || min === undefined || min === "" ? null : Number(min),
  };
};

const topicOrder: Prisma.topicOrderByWithRelationInput[] = [{ order_number: "asc" }, { id: "asc" }];

export class CurriculumService {
  // ---------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------

  private async assertProgram(programId: number) {
    const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) throw new LmsError("Program not found", 404);
  }

  async listModules(programId: number) {
    await this.assertProgram(programId);
    const topicSelect = {
      id: true,
      name: true,
      order_number: true,
      moduleId: true,
      LearningUnit: { select: { id: true, type: true, due_rule: true, grading_category: true } },
    } satisfies Prisma.topicSelect;

    const [modules, unassigned] = await Promise.all([
      prisma.program_module.findMany({
        where: { programId },
        orderBy: [{ order_number: "asc" }, { id: "asc" }],
        include: { topics: { select: topicSelect, orderBy: topicOrder } },
      }),
      prisma.topic.findMany({
        where: { programId, moduleId: null },
        select: topicSelect,
        orderBy: topicOrder,
      }),
    ]);
    return { modules, unassigned };
  }

  async createModule(input: { programId: number; title: string; description?: string | null; weeks?: number | null }) {
    await this.assertProgram(input.programId);
    const last = await prisma.program_module.aggregate({
      where: { programId: input.programId },
      _max: { order_number: true },
    });
    return prisma.program_module.create({
      data: {
        programId: input.programId,
        title: input.title,
        description: input.description ?? null,
        weeks: input.weeks ?? null,
        order_number: (last._max.order_number ?? 0) + 1,
      },
    });
  }

  async updateModule(id: number, input: { title?: string; description?: string | null; weeks?: number | null }) {
    const existing = await prisma.program_module.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Module not found", 404);
    return prisma.program_module.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.weeks !== undefined ? { weeks: input.weeks } : {}),
      },
    });
  }

  /** Units in the module are kept and become unassigned (FK is SET NULL). */
  async deleteModule(id: number) {
    const existing = await prisma.program_module.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Module not found", 404);
    await prisma.program_module.delete({ where: { id } });
    return { id };
  }

  async reorderModules(programId: number, order: { id: number; order_number: number }[]) {
    const modules = await prisma.program_module.findMany({ where: { programId }, select: { id: true } });
    const owned = new Set(modules.map((m) => m.id));
    if (order.some((o) => !owned.has(o.id))) {
      throw new LmsError("Every module must belong to the program");
    }
    await prisma.$transaction(
      order.map((o) => prisma.program_module.update({ where: { id: o.id }, data: { order_number: o.order_number } })),
    );
    return this.listModules(programId);
  }

  async setTopicModule(topicId: number, moduleId: number | null, orderNumber?: number | null) {
    const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: { id: true, programId: true } });
    if (!topic) throw new LmsError("Topic not found", 404);
    if (moduleId !== null) {
      const mod = await prisma.program_module.findUnique({ where: { id: moduleId }, select: { programId: true } });
      if (!mod) throw new LmsError("Module not found", 404);
      if (mod.programId !== topic.programId) throw new LmsError("Module belongs to a different program");
    }
    return prisma.topic.update({
      where: { id: topicId },
      data: {
        moduleId,
        ...(orderNumber !== undefined && orderNumber !== null ? { order_number: orderNumber } : {}),
      },
      select: { id: true, moduleId: true, order_number: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Grading model
  // ---------------------------------------------------------------------------

  async getGrading(programId: number) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        grading_mode: true,
        pass_mark: true,
        grading_weights: true,
        completion_rules: true,
        auto_certificate: true,
      },
    });
    if (!program) throw new LmsError("Program not found", 404);
    return {
      programId: program.id,
      grading_mode: (GRADING_MODES.includes(program.grading_mode as GradingMode)
        ? program.grading_mode
        : "PASS_FAIL") as GradingMode,
      pass_mark: program.pass_mark,
      grading_weights: readWeights(program.grading_weights),
      completion_rules: readCompletion(program.completion_rules),
      auto_certificate: program.auto_certificate,
    };
  }

  async updateGrading(programId: number, body: Record<string, unknown>) {
    const current = await this.getGrading(programId);

    const mode = (body.grading_mode ?? current.grading_mode) as GradingMode;
    if (!GRADING_MODES.includes(mode)) throw new LmsError("grading_mode must be PASS_FAIL or WEIGHTED");

    const passMark = body.pass_mark === undefined ? current.pass_mark : pct(body.pass_mark, "pass_mark");

    let weights = current.grading_weights;
    if (body.grading_weights !== undefined) {
      const raw = (body.grading_weights ?? {}) as Record<string, unknown>;
      weights = {
        quiz: pct(raw.quiz ?? 0, "grading_weights.quiz"),
        essay: pct(raw.essay ?? 0, "grading_weights.essay"),
        exam: pct(raw.exam ?? 0, "grading_weights.exam"),
        attendance: pct(raw.attendance ?? 0, "grading_weights.attendance"),
      };
    }
    if (mode === "WEIGHTED") {
      const total = weights.quiz + weights.essay + weights.exam + weights.attendance;
      if (total !== 100) throw new LmsError(`Category weights must total 100% (currently ${total}%)`);
    }

    let completion = current.completion_rules;
    if (body.completion_rules !== undefined) {
      const raw = (body.completion_rules ?? {}) as Record<string, unknown>;
      completion = {
        requireGrade: raw.requireGrade === undefined ? completion.requireGrade : Boolean(raw.requireGrade),
        requireAllUnits:
          raw.requireAllUnits === undefined ? completion.requireAllUnits : Boolean(raw.requireAllUnits),
        minAttendance:
          raw.minAttendance === undefined
            ? completion.minAttendance
            : raw.minAttendance === null || raw.minAttendance === ""
              ? null
              : pct(raw.minAttendance, "completion_rules.minAttendance"),
      };
    }

    const autoCertificate =
      body.auto_certificate === undefined ? current.auto_certificate : Boolean(body.auto_certificate);

    await prisma.program.update({
      where: { id: programId },
      data: {
        grading_mode: mode,
        pass_mark: passMark,
        grading_weights: weights as unknown as Prisma.InputJsonValue,
        completion_rules: completion as unknown as Prisma.InputJsonValue,
        auto_certificate: autoCertificate,
      },
    });
    return this.getGrading(programId);
  }

  // ---------------------------------------------------------------------------
  // Unit settings: due rule + grading category
  // ---------------------------------------------------------------------------

  async updateUnitSettings(topicId: number, body: Record<string, unknown>) {
    const unit = await prisma.learningUnit.findUnique({ where: { topicId } });
    if (!unit) throw new LmsError("This topic has no learning unit", 404);

    const data: Prisma.LearningUnitUpdateInput = {};
    if (body.due_rule !== undefined) {
      if (body.due_rule === null) {
        data.due_rule = Prisma.DbNull;
      } else {
        const rule = parseDueRule(body.due_rule);
        if (!rule) throw new LmsError("due_rule needs a week (1–104) and either a weekday or a number of days");
        data.due_rule = rule as unknown as Prisma.InputJsonValue;
      }
    }
    if (body.grading_category !== undefined) {
      if (body.grading_category !== null && !UNIT_CATEGORIES.includes(body.grading_category as UnitCategory)) {
        throw new LmsError("grading_category must be quiz, essay, exam or null");
      }
      data.grading_category = body.grading_category as string | null;
    }

    const updated = await prisma.learningUnit.update({
      where: { id: unit.id },
      data,
      select: { id: true, topicId: true, type: true, due_rule: true, grading_category: true },
    });
    return { ...updated, category: categoryForUnit(updated) };
  }

  // ---------------------------------------------------------------------------
  // Cohort schedule, due-date overrides and extensions
  // ---------------------------------------------------------------------------

  async getCohortSchedule(cohortId: number) {
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: {
        id: true,
        name: true,
        startDate: true,
        programId: true,
        program: {
          select: {
            topics: {
              orderBy: topicOrder,
              select: {
                id: true,
                name: true,
                order_number: true,
                moduleId: true,
                LearningUnit: {
                  select: {
                    id: true,
                    type: true,
                    due_rule: true,
                    grading_category: true,
                    cohortAssignments: { where: { cohortId } },
                    extensions: {
                      where: { cohortId },
                      orderBy: { dueDate: "asc" },
                      select: {
                        id: true,
                        enrollmentId: true,
                        dueDate: true,
                        reason: true,
                        enrollment: {
                          select: {
                            user: {
                              select: {
                                name: true,
                                user_info: { select: { first_name: true, last_name: true } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cohort) throw new LmsError("Cohort not found", 404);

    const rows = cohort.program.topics
      .filter((t) => t.LearningUnit && t.LearningUnit.type.startsWith("assignment"))
      .map((t) => {
        const unit = t.LearningUnit!;
        const rule = parseDueRule(unit.due_rule);
        const ruleDueDate = dueDateFromRule(cohort.startDate, rule);
        const assignment = unit.cohortAssignments[0] ?? null;
        const override = assignment?.dueDate ?? null;
        const isOverride =
          Boolean(override) && (!ruleDueDate || override!.getTime() !== ruleDueDate.getTime());
        return {
          topicId: t.id,
          learningUnitId: unit.id,
          name: t.name,
          moduleId: t.moduleId,
          type: unit.type,
          category: categoryForUnit(unit),
          rule,
          ruleLabel: describeDueRule(rule),
          ruleDueDate,
          overrideDueDate: isOverride ? override : null,
          effectiveDueDate: override ?? ruleDueDate,
          isActive: assignment?.isActive ?? false,
          closedAt: assignment?.closedAt ?? null,
          extensions: unit.extensions.map((x) => ({
            id: x.id,
            enrollmentId: x.enrollmentId,
            learnerName:
              [x.enrollment.user?.user_info?.first_name, x.enrollment.user?.user_info?.last_name]
                .filter(Boolean)
                .join(" ") ||
              x.enrollment.user?.name ||
              "Learner",
            dueDate: x.dueDate,
            reason: x.reason,
          })),
        };
      });

    return { cohortId: cohort.id, cohortName: cohort.name, startDate: cohort.startDate, rows };
  }

  private async unitForTopic(topicId: number) {
    const unit = await prisma.learningUnit.findUnique({ where: { topicId }, select: { id: true, type: true } });
    if (!unit || !unit.type.startsWith("assignment")) {
      throw new LmsError("Only quiz and essay units have due dates", 400);
    }
    return unit;
  }

  /** Sets (or clears, with null) this cohort's due date without opening the assessment. */
  async setCohortDueDate(cohortId: number, topicId: number, dueDate: Date | null) {
    const unit = await this.unitForTopic(topicId);
    await prisma.cohort_assignment.upsert({
      where: { cohortId_learningUnitId: { cohortId, learningUnitId: unit.id } },
      update: { dueDate },
      create: { cohortId, learningUnitId: unit.id, isActive: false, dueDate },
    });
    return this.getCohortSchedule(cohortId);
  }

  async grantExtension(input: {
    cohortId: number;
    topicId: number;
    enrollmentId: number;
    dueDate: Date;
    reason?: string | null;
    grantedById: number | null;
  }) {
    const unit = await this.unitForTopic(input.topicId);
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: input.enrollmentId },
      select: { course: { select: { cohortId: true } } },
    });
    if (!enrollment || enrollment.course.cohortId !== input.cohortId) {
      throw new LmsError("Learner is not enrolled in this cohort");
    }
    return prisma.assignment_extension.upsert({
      where: { learningUnitId_enrollmentId: { learningUnitId: unit.id, enrollmentId: input.enrollmentId } },
      update: { dueDate: input.dueDate, reason: input.reason ?? null, grantedById: input.grantedById },
      create: {
        cohortId: input.cohortId,
        learningUnitId: unit.id,
        enrollmentId: input.enrollmentId,
        dueDate: input.dueDate,
        reason: input.reason ?? null,
        grantedById: input.grantedById,
      },
    });
  }

  async removeExtension(id: number) {
    const existing = await prisma.assignment_extension.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Extension not found", 404);
    await prisma.assignment_extension.delete({ where: { id } });
    return { id };
  }

  /** Due date to use when opening an assessment without an explicit date. */
  async defaultDueDateForActivation(cohortId: number, topicId: number): Promise<Date | null> {
    const [cohort, unit] = await Promise.all([
      prisma.cohort.findUnique({ where: { id: cohortId }, select: { startDate: true } }),
      prisma.learningUnit.findUnique({
        where: { topicId },
        select: { due_rule: true, cohortAssignments: { where: { cohortId }, select: { dueDate: true } } },
      }),
    ]);
    if (!cohort || !unit) return null;
    return unit.cohortAssignments[0]?.dueDate ?? dueDateFromRule(cohort.startDate, parseDueRule(unit.due_rule));
  }
}

export const curriculumService = new CurriculumService();
