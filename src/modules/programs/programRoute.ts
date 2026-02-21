import { Router } from "express";
import { ProgramController } from "./programController";
import { EnrollmentController } from "./enrolmentController";
import { CohortController } from "./cohortController";
import { CourseController } from "./courseController";
import { Permissions } from "../../middleWare/authorization";
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
programRouter.post(
  "/enroll",
  [protect, permissions.can_manage_programs_or_facilitator],
  enrollmentController.enrollUser,
);
programRouter.post(
  "/unenroll",
  [protect, permissions.can_manage_programs_or_facilitator],
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
programRouter.get(
  "/assignment-results",
  [protect],
  programController.getAssignmentResults,
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

export default programRouter;
