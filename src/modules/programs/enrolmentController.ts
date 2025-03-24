import { Request, Response } from "express";
import { EnrollmentService } from "./enrolmentService";

const enrollment = new EnrollmentService();

export class EnrollmentController {
async enrollUser(req: Request, res: Response) {
        try {
          const newCourse= await enrollment.enrollUser(req.body.courseId,req.body.userId);
          return res.status(201).json({ message: "User Enrolled Sucessfully", data: newCourse });
        } catch (error:any) {
          return res.status(500).json({ message: "Error enrolling User", error: error.message });
        }
      }

      async getEnrollmentByCourse(req: Request, res: Response) {
        try {
          const allEnrollmentByCourse= await enrollment.getEnrollmentsByCourse(Number(req.params.id));
          return res.status(200).json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
        } catch (error:any) {
          return res.status(500).json({ message: "Error retrieving enrollment", error: error.message });
        }
      }

      async getEnrollmentByUser(req: Request, res: Response) {
        try {
          const allEnrollmentByCourse= await enrollment.getUserEnrollments(Number(req.params.id));
          return res.status(200).json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
        } catch (error:any) {
          return res.status(500).json({ message: "Error enrolling User", error: error.message });
        }}

        async unEnrollUser(req: Request, res: Response) {
            try {
              const allEnrollmentByCourse= await enrollment.unenrollUser(req.body.courseId,req.body.userId);
              return res.status(200).json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
            } catch (error:any) {
              return res.status(500).json({ message: "Error enrolling User", error: error.message });
            }
      }
}