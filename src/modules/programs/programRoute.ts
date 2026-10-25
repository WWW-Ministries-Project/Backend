import { Router } from "express";
import { ProgramController } from "./programController";
import { EnrollmentController } from "./enrolmentController";
import { CohortController } from "./cohortController";
import { CourseController } from "./courseController";
import { Permissions } from "../../middleWare/authorization";
import { bindLearnerToCaller, hideAnswerKeysFromLearners } from "./learnerGuards";
import {
  anyOf,
  cohortFrom,
  courseFrom,
  enrollmentFrom,
  extensionFrom,
  moduleFrom,
  programFrom,
  progressFrom,
  rosterFrom,
  sessionFrom,
  somDeleteGuard,
  somGuard,
  submissionFrom,
  topicFrom,
  type ProgramTarget,
} from "./somAccess";
import { enrollGuard } from "./enrollGuard";
import { assessmentController } from "./lms/assessmentController";
import { curriculumController } from "./lms/curriculumController";
import { operationsController } from "./lms/operationsController";
import { learnerController } from "./lms/learnerController";
const permissions = new Permissions();
const protect = permissions.protect;

const programRouter = Router();
const programController = new ProgramController();
const enrollmentController = new EnrollmentController();
const cohortController = new CohortController();
const courseController = new CourseController();

// School of Ministry actions (src/permissions/catalog.ts). `access` runs the
// live permission lookup the guards in ./somAccess.ts read.
const access = [protect, permissions.withAccess];
const som = (...guards: Parameters<typeof somGuard>) => [...access, somGuard(...guards)];
const somDelete = (target?: Parameters<typeof somDeleteGuard>[0]) => [...access, somDeleteGuard(target)];
const fallback = { programFallback: true } as const;

programRouter.post(
  "/program",
  som("design_curriculum", fallback),
  programController.createProgram,
);
programRouter.get("/programs", [protect], programController.getAllPrograms);
programRouter.get(
  "/programs-full-details",
  som("view", { assigned: "list" }),
  programController.getAllProgramsFullDetailsWithEnrollments,
);
programRouter.get(
  "/program",
  [protect, permissions.withAccess, hideAnswerKeysFromLearners],
  programController.getProgramById,
);
programRouter.put(
  "/program",
  som("design_curriculum", { ...fallback, assigned: "target", target: programFrom("query", "id") }),
  programController.updateProgram,
);
programRouter.delete(
  "/program",
  somDelete(programFrom("query", "id")),
  programController.deleteProgram,
);
programRouter.get(
  "/get-member-programs",
  // Without a userId it lists programs in general (the admin "apply" page).
  [protect, permissions.withAccess, bindLearnerToCaller([["query", "userId"]], { fillMissing: false })],
  programController.getAllProgramForMember,
);
programRouter.get(
  "/get-instructor-programs",
  som("view", { assigned: "list" }),
  programController.getProgramsByinstructor,
);
programRouter.get(
  "/get-cohorts-by-program",
  som("view", { assigned: "target", target: programFrom("query", "programId") }),
  programController.getCohortsByProgram,
);

//cohort enpoint
programRouter.post(
  "/cohort",
  som("manage_cohorts", { ...fallback, assigned: "target", target: programFrom("body", "programId") }),
  cohortController.createCohort,
);
programRouter.get("/cohorts", som("view", { assigned: "list" }), cohortController.getAllCohorts);
programRouter.get(
  "/program-cohort",
  som("view", { assigned: "target", target: programFrom("query", "id") }),
  cohortController.getAllCohortsByProgramID,
);
programRouter.get(
  "/cohort",
  som("view", { assigned: "target", target: cohortFrom("query", "id") }),
  cohortController.getCohortsById,
);
programRouter.put(
  "/cohort",
  som("manage_cohorts", {
    ...fallback,
    assigned: "target",
    target: anyOf(cohortFrom("query", "id"), programFrom("body", "programId")),
  }),
  cohortController.updateChort,
);
programRouter.delete(
  "/cohort",
  somDelete(cohortFrom("query", "id")),
  cohortController.deleteCohort,
);

//course enpoint
programRouter.post(
  "/course",
  som("manage_cohorts", { ...fallback, assigned: "target", target: cohortFrom("body", "cohortId") }),
  courseController.createCourse,
);
programRouter.get("/cohort-courses", som("view", { assigned: "list" }), courseController.getAllCourses);
programRouter.get("/courses", som("view", { assigned: "list" }), courseController.getAllCourses);
programRouter.get(
  "/course",
  som("view", { assigned: "target", target: courseFrom("query", "id") }),
  courseController.getCourseById,
);
programRouter.put(
  "/course",
  som("manage_cohorts", {
    ...fallback,
    assigned: "target",
    target: anyOf(courseFrom("query", "id"), cohortFrom("body", "cohortId")),
  }),
  courseController.updateCourse,
);
programRouter.delete(
  "/course",
  somDelete(courseFrom("query", "id")),
  courseController.deleteCourse,
);
programRouter.get("/users", som("view", { assigned: "list" }), courseController.getAllUsers);

//enrollment endpoint
programRouter.get(
  "/certificate/verify/:certificateNumber",
  enrollmentController.verifyCertificate,
);
programRouter.get("/certificate", [protect], enrollmentController.getCertificate);
programRouter.get("/certificate/pdf", [protect], enrollmentController.getCertificatePdf);
programRouter.post(
  "/enroll",
  [...access, enrollGuard],
  enrollmentController.enrollUser,
);
programRouter.post(
  "/unenroll",
  [...access, enrollGuard],
  enrollmentController.unEnrollUser,
);
programRouter.get(
  "/course-enrollment/:id",
  som("view", { assigned: "target", target: courseFrom("params", "id") }),
  enrollmentController.getEnrollmentByCourse,
);
programRouter.get(
  "/user-enrollment/:id",
  [protect, permissions.withAccess, bindLearnerToCaller([["params", "id"]])],
  enrollmentController.getEnrollmentByUser,
);
programRouter.get(
  "/user-enrollment",
  [protect, permissions.withAccess, bindLearnerToCaller([["query", "userId"], ["query", "user_id"], ["query", "id"]])],
  enrollmentController.getEnrollmentByUser,
);
programRouter.get(
  "/progress",
  som("view", { assigned: "target", target: enrollmentFrom("query", "id") }),
  enrollmentController.getProgressReport,
);
programRouter.put(
  "/progress-update",
  som("edit_progress", { ...fallback, assigned: "target", target: progressFrom }),
  enrollmentController.updateProgressReport,
);
programRouter.put(
  "/progress-updates",
  som("edit_progress", { ...fallback, assigned: "target", target: progressFrom }),
  enrollmentController.updateProgressReports,
);

programRouter.get(
  "/my-enrollment",
  [protect, permissions.withAccess, bindLearnerToCaller([["query", "user_id"]])],
  enrollmentController.myEnrollment,
);

programRouter.get(
  "/program-completion-status",
  [protect, permissions.withAccess, bindLearnerToCaller([["query", "userId"]]), hideAnswerKeysFromLearners],
  programController.getUserProgramCompletionStatus,
);

//Assignment stuffs
programRouter.put(
  "/activate-cohort-assignment",
  som("manage_assignments", { ...fallback, assigned: "target", target: cohortFrom("body", "cohortId") }),
  programController.activateCohortAssignment,
);
programRouter.put(
  "/deactivate-cohort-assignment",
  som("manage_assignments", { ...fallback, assigned: "target", target: cohortFrom("body", "cohortId") }),
  programController.deactivateCohortAssignment,
);
programRouter.get(
  "/is-assignment-active",
  [protect],
  programController.isAssignmentActiveForCohort,
);
programRouter.post(
  "/submit-mcq-assignment",
  [protect, permissions.withAccess, bindLearnerToCaller([["body", "userId"]])],
  programController.submitMCQAssignment,
);
programRouter.post(
  "/submit-essay-assignment",
  [protect, permissions.withAccess, bindLearnerToCaller([["body", "userId"]])],
  programController.submitEssayAssignment,
);
programRouter.get(
  "/assignment-results",
  som("view", {
    assigned: "target",
    target: anyOf(topicFrom("query", "topicId"), cohortFrom("query", "cohortId"), programFrom("query", "programId")),
  }),
  programController.getAssignmentResults,
);
programRouter.put(
  "/grade-assignment",
  som("grade", { ...fallback, assigned: "target", target: submissionFrom("body", "submissionId") }),
  programController.gradeAssignmentSubmission,
);
programRouter.put(
  "/grade-assignments",
  som("grade", { ...fallback, assigned: "target", target: submissionFrom("body", "submissionIds") }),
  programController.gradeAssignmentSubmissions,
);

programRouter.get(
  "/get-cohort-assigments",
  som("view", { assigned: "target", target: cohortFrom("query", "cohortId") }),
  programController.getAssignmentsByCohort,
);

//topics enpoint
programRouter.post(
  "/topic",
  som("design_curriculum", { ...fallback, assigned: "target", target: programFrom("body", "programId") }),
  programController.createTopic,
);
programRouter.put(
  "/topic",
  som("design_curriculum", { ...fallback, assigned: "target", target: topicFrom("query", "id") }),
  programController.updateTopic,
);
programRouter.delete(
  "/topic",
  somDelete(topicFrom("query", "id")),
  programController.deleteTopic,
);
programRouter.get("/topic", [protect, permissions.withAccess, hideAnswerKeysFromLearners], programController.getTopic);
programRouter.get("/topics", [protect, permissions.withAccess, hideAnswerKeysFromLearners], programController.getAllTopics);

programRouter.put(
  "/complete-topic",
  [protect, permissions.withAccess, bindLearnerToCaller([["body", "userId"]])],
  programController.completeTopic,
);
programRouter.put(
  "/reorder-topics",
  som("design_curriculum", { ...fallback, assigned: "target", target: programFrom("body", "programId") }),
  programController.reorderTopics,
);

// LMS: curriculum modules, grading model, due-date rules and extensions.
// Program design needs design_curriculum: the whole school, or an instructor
// whose roster entry allows curriculum editing in that program. Instructors
// run their own cohorts (the controllers check each cohort's roster ability).
const design = (target: ProgramTarget) => som("design_curriculum", { assigned: "target", target });
const designAll = som("design_curriculum");
const assignments = som("manage_assignments", { ...fallback, assigned: "target", target: cohortFrom("body", "cohortId") });
programRouter.get("/modules", som("view", { assigned: "target", target: programFrom("query", "programId") }), curriculumController.listModules);
programRouter.post("/module", design(programFrom("body", "programId")), curriculumController.createModule);
programRouter.put("/module", design(moduleFrom("query", "id")), curriculumController.updateModule);
programRouter.delete("/module", design(moduleFrom("query", "id")), curriculumController.deleteModule);
programRouter.put("/reorder-modules", design(programFrom("body", "programId")), curriculumController.reorderModules);
programRouter.put(
  "/topic-module",
  design(anyOf(topicFrom("body", "topicId"), moduleFrom("body", "moduleId"))),
  curriculumController.setTopicModule,
);
programRouter.get("/grading", som("view", { assigned: "target", target: programFrom("query", "programId") }), curriculumController.getGrading);
programRouter.put("/grading", design(programFrom("query", "programId")), curriculumController.updateGrading);
programRouter.put("/unit-settings", design(topicFrom("body", "topicId")), curriculumController.updateUnitSettings);
programRouter.get(
  "/cohort-schedule",
  som("view", { assigned: "target", target: cohortFrom("query", "cohortId") }),
  curriculumController.getCohortSchedule,
);
programRouter.put("/cohort-due-date", assignments, curriculumController.setCohortDueDate);
programRouter.post("/assignment-extension", assignments, curriculumController.grantExtension);
programRouter.delete(
  "/assignment-extension",
  som("manage_assignments", { ...fallback, assigned: "target", target: extensionFrom("query", "id") }),
  curriculumController.removeExtension,
);

// LMS: question bank, rubrics, gradebook, certificates. The bank and rubrics
// are shared by every program, so only whole-school designers change them.
programRouter.get("/question-bank", som("view", { ...fallback, assigned: "list" }), assessmentController.listQuestions);
programRouter.post("/question-bank", designAll, assessmentController.createQuestion);
programRouter.put("/question-bank", designAll, assessmentController.updateQuestion);
programRouter.delete("/question-bank", designAll, assessmentController.deleteQuestion);
programRouter.post("/question-bank/add-to-unit", design(topicFrom("body", "topicId")), assessmentController.addQuestionsToUnit);
programRouter.get("/rubrics", som("view", { ...fallback, assigned: "list" }), assessmentController.listRubrics);
programRouter.post("/rubric", designAll, assessmentController.createRubric);
programRouter.put("/rubric", designAll, assessmentController.updateRubric);
programRouter.delete("/rubric", designAll, assessmentController.deleteRubric);
programRouter.put("/unit-rubric", design(topicFrom("body", "topicId")), assessmentController.setUnitRubric);
programRouter.get(
  "/submission",
  som("grade", { ...fallback, assigned: "target", target: submissionFrom("query", "id") }),
  assessmentController.getSubmission,
);
programRouter.put(
  "/grade-with-rubric",
  som("grade", { ...fallback, assigned: "target", target: submissionFrom("body", "submissionId") }),
  assessmentController.gradeWithRubric,
);
programRouter.get(
  "/gradebook",
  som("grade", { ...fallback, assigned: "target", target: cohortFrom("query", "cohortId") }),
  assessmentController.getGradebook,
);
programRouter.put(
  "/grade-overrides",
  som("grade", { ...fallback, assigned: "target", target: topicFrom("body", "topicId") }),
  assessmentController.setOverrides,
);
programRouter.get(
  "/certificates",
  som("view", { ...fallback, assigned: "target", target: programFrom("query", "programId") }),
  assessmentController.listCertificates,
);
programRouter.post(
  "/certificates/issue",
  som("issue_certificates", { legacyLevel: "manage", target: programFrom("body", "programId") }),
  assessmentController.issueCertificates,
);

// LMS: sessions, attendance, announcements (instructors limited per cohort in the controller)
const attendance = (target: ProgramTarget) =>
  som("take_attendance", { ...fallback, assigned: "target", target });
programRouter.get(
  "/sessions",
  som("take_attendance", { ...fallback, assigned: "list", target: cohortFrom("query", "cohortId") }),
  operationsController.listSessions,
);
programRouter.post("/session", attendance(cohortFrom("body", "cohortId")), operationsController.createSession);
programRouter.put("/session", attendance(sessionFrom("query", "id")), operationsController.updateSession);
programRouter.delete("/session", attendance(sessionFrom("query", "id")), operationsController.deleteSession);
programRouter.get("/session-attendance", attendance(sessionFrom("query", "sessionId")), operationsController.getAttendance);
programRouter.put("/session-attendance", attendance(sessionFrom("body", "sessionId")), operationsController.saveAttendance);
const announce = (target: ProgramTarget) => som("announce", { ...fallback, assigned: "target", target });
programRouter.get("/announcements", announce(cohortFrom("query", "cohortId")), operationsController.listAnnouncements);
programRouter.post("/announcement", announce(cohortFrom("body", "cohortId")), operationsController.createAnnouncement);

// LMS: applications and review queue
programRouter.post("/apply", [protect], operationsController.apply);
programRouter.get("/apply/eligibility", [protect], operationsController.checkEligibility);
programRouter.get("/applications", som("decide_applications"), operationsController.listApplications);
programRouter.put("/application/decide", som("decide_applications"), operationsController.decideApplication);

// LMS: instructors, content library, reports
programRouter.get(
  "/program-instructors",
  som("view", { ...fallback, assigned: "target", target: programFrom("query", "programId") }),
  operationsController.listRoster,
);
programRouter.post(
  "/program-instructors",
  som("manage_instructors", { legacyLevel: "manage", target: programFrom("body", "programId") }),
  operationsController.addToRoster,
);
programRouter.put(
  "/program-instructor",
  som("manage_instructors", { legacyLevel: "manage", target: rosterFrom("query", "id") }),
  operationsController.updateRoster,
);
programRouter.delete(
  "/program-instructor",
  som("manage_instructors", { legacyLevel: "manage", target: rosterFrom("query", "id") }),
  operationsController.removeFromRoster,
);
programRouter.get("/instructors-overview", som("view"), operationsController.instructorsOverview);
programRouter.get("/library", som("view", { ...fallback, assigned: "list" }), operationsController.listLibrary);
programRouter.post("/library-item", designAll, operationsController.createLibraryItem);
programRouter.put("/library-item", designAll, operationsController.updateLibraryItem);
programRouter.delete("/library-item", designAll, operationsController.deleteLibraryItem);
programRouter.post("/library/use", design(programFrom("body", "programId")), operationsController.useLibraryItem);
programRouter.get("/lms-reports", som("view_reports"), operationsController.reports);

// LMS: learner portal (signed-in member's own enrollments only)
programRouter.get("/learner/overview", [protect], learnerController.overview);
programRouter.get("/learner/sessions", [protect], learnerController.sessions);
programRouter.get("/learner/announcements", [protect], learnerController.announcements);
programRouter.get("/learner/submission", [protect], learnerController.submission);

export default programRouter;
