import { Router } from "express";
import { ProgramController } from "./programController";
import { EnrollmentController } from "./enrolmentController";
import { CohortController } from "./cohortController";
import { CourseController } from "./courseController";
import { Permissions } from "../../middleWare/authorization";
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

programRouter.post(
  "/program",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.createProgram,
);
programRouter.get("/programs", [protect], programController.getAllPrograms);
programRouter.get(
  "/programs-full-details",
  [protect],
  programController.getAllProgramsFullDetailsWithEnrollments,
);
programRouter.get("/program", [protect], programController.getProgramById);
programRouter.put(
  "/program",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.updateProgram,
);
programRouter.delete(
  "/program",
  [protect, permissions.can_delete_programs],
  programController.deleteProgram,
);
programRouter.get(
  "/get-member-programs",
  [protect],
  programController.getAllProgramForMember,
);
programRouter.get(
  "/get-instructor-programs",
  [protect],
  programController.getProgramsByinstructor,
);
programRouter.get(
  "/get-cohorts-by-program",
  [protect],
  programController.getCohortsByProgram,
);

//cohort enpoint
programRouter.post(
  "/cohort",
  [protect, permissions.can_manage_programs_or_facilitator],
  cohortController.createCohort,
);
programRouter.get("/cohorts", [protect], cohortController.getAllCohorts);
programRouter.get(
  "/program-cohort",
  [protect],
  cohortController.getAllCohortsByProgramID,
);
programRouter.get("/cohort", [protect], cohortController.getCohortsById);
programRouter.put(
  "/cohort",
  [protect, permissions.can_manage_programs_or_facilitator],
  cohortController.updateChort,
);
programRouter.delete(
  "/cohort",
  [protect, permissions.can_delete_programs],
  cohortController.deleteCohort,
);

//course enpoint
programRouter.post(
  "/course",
  [protect, permissions.can_manage_programs_or_facilitator],
  courseController.createCourse,
);
programRouter.get("/cohort-courses", [protect], courseController.getAllCourses);
programRouter.get("/courses", [protect], courseController.getAllCourses);
programRouter.get("/course", [protect], courseController.getCourseById);
programRouter.put(
  "/course",
  [protect, permissions.can_manage_programs_or_facilitator],
  courseController.updateCourse,
);
programRouter.delete(
  "/course",
  [protect, permissions.can_delete_programs],
  courseController.deleteCourse,
);
programRouter.get("/users", [protect], courseController.getAllUsers);

//enrollment endpoint
programRouter.get(
  "/certificate/verify/:certificateNumber",
  enrollmentController.verifyCertificate,
);
programRouter.get("/certificate", [protect], enrollmentController.getCertificate);
programRouter.get("/certificate/pdf", [protect], enrollmentController.getCertificatePdf);
programRouter.post(
  "/enroll",
  [protect, permissions.can_enroll_self_or_manage],
  enrollmentController.enrollUser,
);
programRouter.post(
  "/unenroll",
  [protect, permissions.can_enroll_self_or_manage],
  enrollmentController.unEnrollUser,
);
programRouter.get(
  "/course-enrollment/:id",
  [protect],
  enrollmentController.getEnrollmentByCourse,
);
programRouter.get(
  "/user-enrollment/:id",
  [protect],
  enrollmentController.getEnrollmentByUser,
);
programRouter.get(
  "/user-enrollment",
  [protect],
  enrollmentController.getEnrollmentByUser,
);
programRouter.get("/progress", [protect], enrollmentController.getProgressReport);
programRouter.put(
  "/progress-update",
  [protect, permissions.can_manage_programs_or_facilitator],
  enrollmentController.updateProgressReport,
);
programRouter.put(
  "/progress-updates",
  [protect, permissions.can_manage_programs_or_facilitator],
  enrollmentController.updateProgressReports,
);

programRouter.get("/my-enrollment", [protect], enrollmentController.myEnrollment);

programRouter.get(
  "/program-completion-status",
  [protect],
  programController.getUserProgramCompletionStatus,
);

//Assignment stuffs
programRouter.put(
  "/activate-cohort-assignment",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.activateCohortAssignment,
);
programRouter.put(
  "/deactivate-cohort-assignment",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.deactivateCohortAssignment,
);
programRouter.get(
  "/is-assignment-active",
  [protect],
  programController.isAssignmentActiveForCohort,
);
programRouter.post(
  "/submit-mcq-assignment",
  [protect],
  programController.submitMCQAssignment,
);
programRouter.post(
  "/submit-essay-assignment",
  [protect],
  programController.submitEssayAssignment,
);
programRouter.get(
  "/assignment-results",
  [protect],
  programController.getAssignmentResults,
);
programRouter.put(
  "/grade-assignment",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.gradeAssignmentSubmission,
);
programRouter.put(
  "/grade-assignments",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.gradeAssignmentSubmissions,
);

programRouter.get(
  "/get-cohort-assigments",
  [protect],
  programController.getAssignmentsByCohort,
);

//topics enpoint
programRouter.post(
  "/topic",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.createTopic,
);
programRouter.put(
  "/topic",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.updateTopic,
);
programRouter.delete(
  "/topic",
  [protect, permissions.can_delete_programs],
  programController.deleteTopic,
);
programRouter.get("/topic", [protect], programController.getTopic);
programRouter.get("/topics", [protect], programController.getAllTopics);

programRouter.put("/complete-topic", [protect], programController.completeTopic);
programRouter.put(
  "/reorder-topics",
  [protect, permissions.can_manage_programs_or_facilitator],
  programController.reorderTopics,
);

// LMS: curriculum modules, grading model, due-date rules and extensions
// Program design is admin-only; instructors (facilitators) may run cohorts.
const design = [protect, permissions.can_manage_school_of_ministry];
const manage = [protect, permissions.can_manage_programs_or_facilitator];
programRouter.get("/modules", [protect], curriculumController.listModules);
programRouter.post("/module", design, curriculumController.createModule);
programRouter.put("/module", design, curriculumController.updateModule);
programRouter.delete("/module", design, curriculumController.deleteModule);
programRouter.put("/reorder-modules", design, curriculumController.reorderModules);
programRouter.put("/topic-module", design, curriculumController.setTopicModule);
programRouter.get("/grading", [protect], curriculumController.getGrading);
programRouter.put("/grading", design, curriculumController.updateGrading);
programRouter.put("/unit-settings", design, curriculumController.updateUnitSettings);
programRouter.get("/cohort-schedule", [protect], curriculumController.getCohortSchedule);
programRouter.put("/cohort-due-date", manage, curriculumController.setCohortDueDate);
programRouter.post("/assignment-extension", manage, curriculumController.grantExtension);
programRouter.delete("/assignment-extension", manage, curriculumController.removeExtension);

// LMS: question bank, rubrics, gradebook, certificates
programRouter.get("/question-bank", manage, assessmentController.listQuestions);
programRouter.post("/question-bank", design, assessmentController.createQuestion);
programRouter.put("/question-bank", design, assessmentController.updateQuestion);
programRouter.delete("/question-bank", design, assessmentController.deleteQuestion);
programRouter.post("/question-bank/add-to-unit", design, assessmentController.addQuestionsToUnit);
programRouter.get("/rubrics", manage, assessmentController.listRubrics);
programRouter.post("/rubric", design, assessmentController.createRubric);
programRouter.put("/rubric", design, assessmentController.updateRubric);
programRouter.delete("/rubric", design, assessmentController.deleteRubric);
programRouter.put("/unit-rubric", design, assessmentController.setUnitRubric);
programRouter.get("/submission", manage, assessmentController.getSubmission);
programRouter.put("/grade-with-rubric", manage, assessmentController.gradeWithRubric);
programRouter.get("/gradebook", manage, assessmentController.getGradebook);
programRouter.put("/grade-overrides", manage, assessmentController.setOverrides);
programRouter.get("/certificates", manage, assessmentController.listCertificates);
programRouter.post("/certificates/issue", design, assessmentController.issueCertificates);

// LMS: sessions, attendance, announcements (facilitators scoped per program in the controller)
programRouter.get("/sessions", manage, operationsController.listSessions);
programRouter.post("/session", manage, operationsController.createSession);
programRouter.put("/session", manage, operationsController.updateSession);
programRouter.delete("/session", manage, operationsController.deleteSession);
programRouter.get("/session-attendance", manage, operationsController.getAttendance);
programRouter.put("/session-attendance", manage, operationsController.saveAttendance);
programRouter.get("/announcements", manage, operationsController.listAnnouncements);
programRouter.post("/announcement", manage, operationsController.createAnnouncement);

// LMS: applications and review queue
programRouter.post("/apply", [protect], operationsController.apply);
programRouter.get("/apply/eligibility", [protect], operationsController.checkEligibility);
programRouter.get("/applications", design, operationsController.listApplications);
programRouter.put("/application/decide", design, operationsController.decideApplication);

// LMS: instructors, content library, reports
programRouter.get("/program-instructors", manage, operationsController.listRoster);
programRouter.post("/program-instructors", design, operationsController.addToRoster);
programRouter.put("/program-instructor", design, operationsController.updateRoster);
programRouter.delete("/program-instructor", design, operationsController.removeFromRoster);
programRouter.get("/instructors-overview", design, operationsController.instructorsOverview);
programRouter.get("/library", manage, operationsController.listLibrary);
programRouter.post("/library-item", design, operationsController.createLibraryItem);
programRouter.put("/library-item", design, operationsController.updateLibraryItem);
programRouter.delete("/library-item", design, operationsController.deleteLibraryItem);
programRouter.post("/library/use", design, operationsController.useLibraryItem);
programRouter.get("/lms-reports", design, operationsController.reports);

// LMS: learner portal (signed-in member's own enrollments only)
programRouter.get("/learner/overview", [protect], learnerController.overview);
programRouter.get("/learner/sessions", [protect], learnerController.sessions);
programRouter.get("/learner/announcements", [protect], learnerController.announcements);
programRouter.get("/learner/submission", [protect], learnerController.submission);

export default programRouter;
