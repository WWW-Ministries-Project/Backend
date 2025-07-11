import { Request, Response } from "express";
import { EnrollmentService } from "./enrolmentService";

const enrollment = new EnrollmentService();

export class EnrollmentController {
  async enrollUser(req: Request, res: Response) {
    try {
      const { user_id, course_id } = req.body;

      // Validate required fields
      if (!user_id || !course_id ) {
        return res.status(400).json({
          message:
            "Missing required fields user_id,course_id",
        });
      }

      const newEnrollment = await enrollment.enrollUser({
        course_id: parseInt(course_id as string),
        user_id: parseInt(user_id as string)
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
  }

  async getEnrollmentByCourse(req: Request, res: Response) {
    try {
      const allEnrollmentByCourse = await enrollment.getEnrollmentsByCourse(
        Number(req.params.id),
      );
      return res
        .status(200)
        .json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error retrieving enrollment", error: error.message });
    }
  }

  async getEnrollmentByUser(req: Request, res: Response) {
    try {
      const allEnrollmentByCourse = await enrollment.getUserEnrollments(
        Number(req.params.id),
      );
      return res
        .status(200)
        .json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error enrolling User", error: error.message });
    }
  }

  async unEnrollUser(req: Request, res: Response) {
    try {
      const allEnrollmentByCourse = await enrollment.unenrollUser(
        req.body.course_id,
        req.body.user_id,
      );
      return res
        .status(200)
        .json({ message: "Operation sucessfull", data: allEnrollmentByCourse });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error enrolling User", error: error.message });
    }
  }

  async getProgressReport(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const progressDetails = await enrollment.getProgressDetails(
        Number(id),
      );
      return res
        .status(200)
        .json({ message: "Operation sucessfull", data: progressDetails });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error retrieving Progress report",
        error: error.message,
      });
    }
  }

  async updateProgressReport(req: Request, res: Response) {
    try {
      const { progressId, score, status, notes } = req.body;
      const progressDetails = await enrollment.updateProgressScore(
        progressId,
        score,
        status,
        notes,
      );
      return res
        .status(200)
        .json({ message: "Operation sucessfull", data: progressDetails });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating Progress report",
        error: error.message,
      });
    }
  }

  async updateProgressReports(req: Request, res: Response) {
    const { progressUpdates } = req.body;

    try {
      const response = await enrollment.updateProgressScores(progressUpdates);
      if (response) {
        res.status(200).json({
          message: "Progress scores updated successfully.",
        });
      } else {
        res.status(200).json({
          message: "Progress scores not updated successfully.",
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: "Failed to update progress scores.",
        error,
      });
    }
  }
}
