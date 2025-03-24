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


programRouter.post("/programs", [protect, permissions.can_manage_programs],programController.createProgram);
programRouter.get("/programs",[protect, permissions.can_view_programs], programController.getAllPrograms);
programRouter.get("/programs/:id",[protect, permissions.can_view_programs],programController.getProgramById);
programRouter.put("/programs/:id", [protect, permissions.can_manage_programs],programController.updateProgram);
programRouter.delete("/programs/:id",[protect, permissions.can_manage_programs], programController.deleteProgram);

//cohort enpoint
programRouter.post("/cohorts", [protect, permissions.can_manage_programs], cohortController.createCohort);
programRouter.get("/cohorts", [protect, permissions.can_view_programs],cohortController.getAllCohorts);
programRouter.get("/program-cohorts/:id", [protect, permissions.can_view_programs], cohortController.getAllCohortsByProgramID)
programRouter.get("/cohorts/:id",[protect, permissions.can_view_programs],cohortController.getCohortsById);
programRouter.put("/cohorts/:id", [protect, permissions.can_manage_programs], cohortController.updateChorts);
programRouter.delete("/cohorts/:id",[protect, permissions.can_manage_programs], cohortController.deleteCohort);

//course enpoint
programRouter.post("/courses", [protect, permissions.can_manage_programs],courseController.createCourse);
programRouter.get("/courses", [protect, permissions.can_view_programs],courseController.getAllCourses);
programRouter.get("/courses/:id",[protect, permissions.can_view_programs],courseController.getCourseById);
programRouter.put("/courses/:id", [protect, permissions.can_manage_programs],courseController.updateCourse);
programRouter.delete("/courses/:id",[protect, permissions.can_manage_programs],courseController.deleteCourse);


//enrollment endpoint
programRouter.post("/enroll",[protect, permissions.can_manage_programs], enrollmentController.enrollUser);
programRouter.post("/unenroll", [protect, permissions.can_manage_programs],enrollmentController.unEnrollUser);
programRouter.get("/course-enrollment",[protect, permissions.can_view_programs], enrollmentController.getEnrollmentByCourse)
programRouter.get("/user-enrollment", [protect, permissions.can_view_programs], enrollmentController.getEnrollmentByCourse)

export default programRouter;
