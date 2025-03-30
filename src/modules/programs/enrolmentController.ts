import { Request, Response } from "express";
import { EnrollmentService } from "./enrolmentService";

const enrollment = new EnrollmentService();

export class EnrollmentController {
      async enrollUser(req: Request, res: Response) {
        try {
          const { firstName, lastName, email, phone, courseId, isMember, userId } = req.body;

          // Validate required fields
          if (!firstName || !lastName || !email || !phone || !courseId) {
            return res.status(400).json({ message: "Missing required fields firstName, lastName, email, phone, courseId" });
          }

          const newEnrollment = await enrollment.enrollUser({
            firstName,
            lastName,
            email,
            phone,
            courseId,
            isMember,
            userId
          });

          return res.status(201).json({
            message: "User Enrolled Successfully",
            data: newEnrollment,
          });

        } catch (error: any) {
          return res.status(500).json({
            message: "Error enrolling user",
            error: error.message,
          });
        }
      };

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

      async getProgressReport(req: Request, res: Response) {
        try {
          const enrollmentId = req.params.id
         const progressDetails = await enrollment.getProgressDetails(Number(enrollmentId))
          return res.status(200).json({ message: "Operation sucessfull", data: progressDetails });
        } catch (error:any) {
          return res.status(500).json({ message: "Error retrieving Progress report", error: error.message });
        }
      }

      async updateProgressReport(req: Request, res: Response) {
        try {

          const {progressId, score, status} = req.body
         const progressDetails = await enrollment.updateProgressScores(progressId, score, status)
          return res.status(200).json({ message: "Operation sucessfull", data: progressDetails });
        } catch (error:any) {
          return res.status(500).json({ message: "Error updating Progress report", error: error.message });
        }
      }
}