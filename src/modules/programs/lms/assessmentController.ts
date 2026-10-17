import { assessmentService } from "./assessmentService";
import { assertCohortAbility, assertProgramAbility, programIdForSubmission, programIdForTopic } from "./lmsAccess";
import { LmsError, lmsHandler, optionalPositiveInt, positiveInt, requestUserId } from "./lmsHttp";

const idList = (value: unknown, field: string) => {
  const list = Array.isArray(value) ? value : [];
  if (!list.length) throw new LmsError(`${field} must be a non-empty array`);
  return Array.from(new Set(list.map((v) => positiveInt(v, `${field}[]`))));
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export const assessmentController = {
  // Question bank
  listQuestions: lmsHandler("Questions fetched", (req) =>
    assessmentService.listQuestions({
      search: text(req.query.search) ?? undefined,
      type: text(req.query.type) ?? undefined,
      tag: text(req.query.tag) ?? undefined,
    }),
  ),
  createQuestion: lmsHandler("Question created", (req) =>
    assessmentService.createQuestion(req.body ?? {}, requestUserId(req)),
  ),
  updateQuestion: lmsHandler("Question updated", (req) =>
    assessmentService.updateQuestion(positiveInt(req.query.id, "id"), req.body ?? {}),
  ),
  deleteQuestion: lmsHandler("Question deleted", (req) =>
    assessmentService.deleteQuestion(positiveInt(req.query.id, "id")),
  ),
  addQuestionsToUnit: lmsHandler("Questions added", (req) =>
    assessmentService.addQuestionsToUnit(
      positiveInt(req.body.topicId, "topicId"),
      idList(req.body.questionIds, "questionIds"),
    ),
  ),

  // Rubrics
  listRubrics: lmsHandler("Rubrics fetched", () => assessmentService.listRubrics()),
  createRubric: lmsHandler("Rubric created", (req) =>
    assessmentService.createRubric(req.body ?? {}, requestUserId(req)),
  ),
  updateRubric: lmsHandler("Rubric updated", (req) =>
    assessmentService.updateRubric(positiveInt(req.query.id, "id"), req.body ?? {}),
  ),
  deleteRubric: lmsHandler("Rubric deleted", (req) =>
    assessmentService.deleteRubric(positiveInt(req.query.id, "id")),
  ),
  setUnitRubric: lmsHandler("Rubric attached", (req) =>
    assessmentService.setUnitRubric(
      positiveInt(req.body.topicId, "topicId"),
      optionalPositiveInt(req.body.rubricId, "rubricId"),
    ),
  ),
  getSubmission: lmsHandler("Submission fetched", async (req) => {
    const id = positiveInt(req.query.id, "id");
    await assertProgramAbility(req, await programIdForSubmission(id), "can_grade");
    return assessmentService.getSubmissionForGrading(id);
  }),
  gradeWithRubric: lmsHandler("Submission graded", async (req) => {
    const submissionId = positiveInt(req.body.submissionId, "submissionId");
    await assertProgramAbility(req, await programIdForSubmission(submissionId), "can_grade");
    const scores = req.body?.scores;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
      throw new LmsError("scores must map each criterion id to a level id");
    }
    return assessmentService.gradeWithRubric({
      submissionId,
      scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, String(v)])),
      feedback: text(req.body.feedback),
      actorUserId: requestUserId(req),
    });
  }),

  // Gradebook
  getGradebook: lmsHandler("Gradebook fetched", async (req) => {
    const cohortId = positiveInt(req.query.cohortId, "cohortId");
    await assertCohortAbility(req, cohortId, "can_grade");
    return assessmentService.getGradebook(cohortId, optionalPositiveInt(req.query.courseId, "courseId"));
  }),
  setOverrides: lmsHandler("Grades updated", async (req) => {
    await assertProgramAbility(req, await programIdForTopic(positiveInt(req.body.topicId, "topicId")), "can_grade");
    const clear = req.body?.clear === true;
    const excused = req.body?.excused === true;
    const rawScore = req.body?.score;
    const score = rawScore === null || rawScore === undefined || rawScore === "" ? null : Number(rawScore);
    if (score !== null && !Number.isFinite(score)) throw new LmsError("score must be a number");
    return assessmentService.setOverrides({
      topicId: positiveInt(req.body.topicId, "topicId"),
      enrollmentIds: idList(req.body.enrollmentIds, "enrollmentIds"),
      score: score === null ? null : Math.round(score),
      excused,
      clear,
      note: text(req.body.note),
      userId: requestUserId(req),
    });
  }),

  // Certificates
  listCertificates: lmsHandler("Certificates fetched", async (req) => {
    const programId = positiveInt(req.query.programId, "programId");
    await assertProgramAbility(req, programId, "can_grade");
    return assessmentService.listCertificates(programId);
  }),
  issueCertificates: lmsHandler("Certificates issued", (req) =>
    assessmentService.issueCertificates(
      positiveInt(req.body.programId, "programId"),
      idList(req.body.userIds, "userIds"),
    ),
  ),
};
