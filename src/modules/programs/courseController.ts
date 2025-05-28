import { Request, Response } from "express";
import { CourseService } from "./courseService";
import { prisma } from "../../Models/context";

const courseService = new CourseService();
export class CourseController {
  async getAllUsers(req: Request, res: Response) {
    try {
      const users = await courseService.getAllUsers();
      return res.status(200).json({ message: "all users", data: users });
    } catch (error: any) {
      throw new Error(`Error fetching users ${error.message}`);
    }
  }

  async createCourse(req: Request, res: Response) {
    try {
      const newCourse = await courseService.createCourse(
        req.body.cohortId,
        req.body,
      );
      return res
        .status(201)
        .json({ message: "Course created", data: newCourse });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error creating class", error: error.message });
    }
  }

  async getAllCourses(req: Request, res: Response) {
    try {
      const courses = await courseService.getAllCourses(Number(req.params.id));
      return res.status(200).json({ data: courses });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching courses", error: error.message });
    }
  }

  async getCourseById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const program = await courseService.getCourseById(Number(id));
      if (!program)
        return res.status(404).json({ message: "Course not found" });

      return res.status(200).json({ data: program });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching program", error: error.message });
    }
  }

  async updateCourse(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updatedProgram = await courseService.updateCourse(
        Number(id),
        req.body,
      );
      return res
        .status(200)
        .json({ message: "Course updated", data: updatedProgram });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error updating course", error: error.message });
    }
  }

  async deleteCourse(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await courseService.deleteCourse(Number(id));
      return res.status(200).json({ message: "Course deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting course", error: error.message });
    }
  }
}
