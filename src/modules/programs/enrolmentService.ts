import { prisma } from "../../Models/context";


export class EnrollmentService {
    async enrollUser(courseId: number, userId: number) {
      // Check if user is already enrolled
      const existingEnrollment = await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });
  
      if (existingEnrollment) {
        throw new Error("User is already enrolled in this course.");
      }
  
      // Get the course to check capacity
      const course = await prisma.course.findUnique({
        where: { id: courseId },
      });
  
      if (!course) {
        throw new Error("Course not found.");
      }
  
      if (course.enrolled >= course.capacity) {
        throw new Error("Course is full.");
      }
  
      // Enroll user and update enrolled count
      const enrollment = await prisma.enrollment.create({
        data: { userId, courseId },
      });
  
      await prisma.course.update({
        where: { id: courseId },
        data: { enrolled: course.enrolled + 1 },
      });
  
      return enrollment;
    }
  
    async getEnrollmentsByCourse(courseId: number) {
      return await prisma.enrollment.findMany({
        where: { courseId },
        include: { user: true },
      });
    }
  
    async getUserEnrollments(userId: number) {
      return await prisma.enrollment.findMany({
        where: { userId },
        include: { course: true },
      });
    }
  
    async unenrollUser(courseId: number, userId: number) {
      // Remove enrollment
      const enrollment = await prisma.enrollment.delete({
        where: { userId_courseId: { userId, courseId } },
      });
  
      // Update enrolled count
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (course) {
        await prisma.course.update({
          where: { id: courseId },
          data: { enrolled: course.enrolled - 1 },
        });
      }
  
      return enrollment;
    }
  }
