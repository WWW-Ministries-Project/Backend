import { prisma } from "../../Models/context";

export class CourseService {
    async createCourse(cohortId: number, data: any) {
      return await prisma.course.create({
        data: {
          name: data.name,
          instructor: data.instructor,
          capacity: data.capacity,
          schedule: data.schedule,
          cohortId,
        },
      });
    }
  
    async getAllCourses(cohortId: number) {
      return await prisma.course.findMany({
        where: { cohortId },
        include: { cohort: true },
      });
    }
  
    async getCourseById(id: number) {
      return await prisma.course.findUnique({
        where: { id },
        include: { cohort: true, enrollments: true },
      });
    }
  
    async updateCourse(id: number, data: any) {
      return await prisma.course.update({
        where: { id },
        data,
      });
    }
  
    async deleteCourse(id: number) {
      return await prisma.course.delete({
        where: { id },
      });
    }
  }