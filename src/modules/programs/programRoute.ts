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

programRouter.post("/program", programController.createProgram);
programRouter.get("/programs", programController.getAllPrograms);
programRouter.get("/program", programController.getProgramById);
programRouter.put("/program", programController.updateProgram);
programRouter.delete("/program", programController.deleteProgram);

//cohort enpoint
programRouter.post("/cohort", cohortController.createCohort);
programRouter.get("/cohorts", cohortController.getAllCohorts);
programRouter.get(
  "/program-cohort",
  cohortController.getAllCohortsByProgramID,
);
programRouter.get("/cohort", cohortController.getCohortsById);
programRouter.put("/cohort", cohortController.updateChort);
programRouter.delete("/cohort", cohortController.deleteCohort);

//course enpoint
programRouter.post("/course", courseController.createCourse);
programRouter.get("/cohort-courses", courseController.getAllCourses);
programRouter.get("/course", courseController.getCourseById);
programRouter.put("/course", courseController.updateCourse);
programRouter.delete("/course", courseController.deleteCourse);
programRouter.get("/users", courseController.getAllUsers);

//enrollment endpoint
programRouter.post("/enroll", enrollmentController.enrollUser);
programRouter.post("/unenroll", enrollmentController.unEnrollUser);
programRouter.get(
  "/course-enrollment/:id",
  enrollmentController.getEnrollmentByCourse,
);
programRouter.get(
  "/user-enrollment/:id",
  enrollmentController.getEnrollmentByUser,
);
programRouter.get("/progress", enrollmentController.getProgressReport);
programRouter.put(
  "/progress-update",
  enrollmentController.updateProgressReport,
);
programRouter.put(
  "/progress-updates",
  enrollmentController.updateProgressReports,
);

programRouter.get(
  "/my-enrollment",
  enrollmentController.myEnrollment
)

//topics enpoint
programRouter.post("/topic", programController.createTopic);
programRouter.put("/topic", programController.updateTopic);
programRouter.delete("/topic", programController.deleteTopic);

export default programRouter;
