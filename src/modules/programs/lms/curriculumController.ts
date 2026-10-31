import { curriculumService } from "./curriculumService";
import { assertCohortAbility, assertProgramAbility, programIdForExtension } from "./lmsAccess";
import {
  LmsError,
  lmsHandler,
  optionalDate,
  optionalPositiveInt,
  positiveInt,
  requestUserId,
  requiredText,
} from "./lmsHttp";

const optionalText = (value: unknown) =>
  value === undefined ? undefined : typeof value === "string" && value.trim() ? value.trim() : null;

const optionalWeeks = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 104) throw new LmsError("weeks must be a whole number from 0 to 104");
  return n;
};

export const curriculumController = {
  listModules: lmsHandler("Modules fetched", (req) =>
    curriculumService.listModules(positiveInt(req.query.programId, "programId")),
  ),

  createModule: lmsHandler("Module created", (req) =>
    curriculumService.createModule({
      programId: positiveInt(req.body.programId, "programId"),
      title: requiredText(req.body.title, "title"),
      description: optionalText(req.body.description) ?? null,
      weeks: optionalWeeks(req.body.weeks) ?? null,
    }),
  ),

  updateModule: lmsHandler("Module updated", (req) =>
    curriculumService.updateModule(positiveInt(req.query.id, "id"), {
      title: req.body.title === undefined ? undefined : requiredText(req.body.title, "title"),
      description: optionalText(req.body.description),
      weeks: optionalWeeks(req.body.weeks),
    }),
  ),

  deleteModule: lmsHandler("Module deleted", (req) =>
    curriculumService.deleteModule(positiveInt(req.query.id, "id")),
  ),

  reorderModules: lmsHandler("Modules reordered", (req) => {
    const programId = positiveInt(req.body.programId, "programId");
    const modules = Array.isArray(req.body.modules) ? req.body.modules : null;
    if (!modules || !modules.length) throw new LmsError("modules must be a non-empty array");
    return curriculumService.reorderModules(
      programId,
      modules.map((m: { id: unknown; order_number: unknown }) => ({
        id: positiveInt(m?.id, "modules[].id"),
        order_number: positiveInt(m?.order_number, "modules[].order_number"),
      })),
    );
  }),

  setTopicModule: lmsHandler("Unit moved", (req) =>
    curriculumService.setTopicModule(
      positiveInt(req.body.topicId, "topicId"),
      optionalPositiveInt(req.body.moduleId, "moduleId"),
      optionalPositiveInt(req.body.order_number, "order_number"),
    ),
  ),

  getGrading: lmsHandler("Grading fetched", (req) =>
    curriculumService.getGrading(positiveInt(req.query.programId, "programId")),
  ),

  updateGrading: lmsHandler("Grading updated", (req) =>
    curriculumService.updateGrading(positiveInt(req.query.programId, "programId"), req.body ?? {}),
  ),

  updateUnitSettings: lmsHandler("Unit settings updated", (req) =>
    curriculumService.updateUnitSettings(positiveInt(req.body.topicId, "topicId"), req.body ?? {}),
  ),

  getCohortSchedule: lmsHandler("Schedule fetched", (req) =>
    curriculumService.getCohortSchedule(positiveInt(req.query.cohortId, "cohortId")),
  ),

  setCohortDueDate: lmsHandler("Due date updated", async (req) => {
    const cohortId = positiveInt(req.body.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_grade");
    return curriculumService.setCohortDueDate(
      cohortId,
      positiveInt(req.body.topicId, "topicId"),
      optionalDate(req.body.dueDate, "dueDate"),
    );
  }),

  grantExtension: lmsHandler("Extension granted", async (req) => {
    const dueDate = optionalDate(req.body.dueDate, "dueDate");
    if (!dueDate) throw new LmsError("dueDate is required");
    const cohortId = positiveInt(req.body.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_grade");
    return curriculumService.grantExtension({
      cohortId,
      topicId: positiveInt(req.body.topicId, "topicId"),
      enrollmentId: positiveInt(req.body.enrollmentId, "enrollmentId"),
      dueDate,
      reason: optionalText(req.body.reason) ?? null,
      grantedById: requestUserId(req),
    });
  }),

  removeExtension: lmsHandler("Extension removed", async (req) => {
    const id = positiveInt(req.query.id, "id");
    await assertProgramAbility(req, await programIdForExtension(id), "can_grade");
    return curriculumService.removeExtension(id);
  }),
};
