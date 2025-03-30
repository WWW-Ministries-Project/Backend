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


programRouter.post("/programs",programController.createProgram);
programRouter.get("/programs", programController.getAllPrograms);
programRouter.get("/programs/:id", programController.getProgramById);
programRouter.put("/programs/:id", programController.updateProgram);
programRouter.delete("/programs/:id", programController.deleteProgram);

//cohort enpoint
programRouter.post("/cohorts", cohortController.createCohort);
programRouter.get("/cohorts", cohortController.getAllCohorts);
programRouter.get("/program-cohorts/:id", cohortController.getAllCohortsByProgramID)
programRouter.get("/cohorts/:id", cohortController.getCohortsById);
programRouter.put("/cohorts/:id", cohortController.updateChorts);
programRouter.delete("/cohorts/:id", cohortController.deleteCohort);

//course enpoint
programRouter.post("/courses", courseController.createCourse);
programRouter.get("/cohort-courses/:id", courseController.getAllCourses);
programRouter.get("/courses/:id", courseController.getCourseById);
programRouter.put("/courses/:id", courseController.updateCourse);
programRouter.delete("/courses/:id", courseController.deleteCourse);
programRouter.get("/users", courseController.getAllUsers)


//enrollment endpoint
programRouter.post("/enroll", enrollmentController.enrollUser);
programRouter.post("/unenroll", enrollmentController.unEnrollUser);
programRouter.get("/course-enrollment/:id", enrollmentController.getEnrollmentByCourse)
programRouter.get("/user-enrollment/:id", enrollmentController.getEnrollmentByUser)
programRouter.get("/progress/:id", enrollmentController.getProgressReport)
programRouter.put("/progress", enrollmentController.updateProgressReport)

//topics enpoint
programRouter.post("/topic", programController.createTopic)
programRouter.put("/topic", programController.updateTopic)
programRouter.delete("/topic/:id", programController.deleteTopic)

export default programRouter;
