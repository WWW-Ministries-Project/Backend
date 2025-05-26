import { prisma } from "../../Models/context";

export class CourseService {
  async getAllUsers() {
    return await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        is_active: true,
        user_info: {
          select: {
            first_name: true,
            last_name: true,
            primary_number: true,
            other_number: true,
          },
        },
      },
    });
  }

  async createCourse(cohortId: number, data: any) {
    return await prisma.course.create({
      data: {
        name: data.name,
        instructor: data.instructor,
        capacity: data.capacity,
        schedule: data.schedule,
        classFormat: data.classFormat,
        location: data.location,
        meetingLink: data.meetingLink,
        cohortId,
      },
    });
  }

  async getAllCourses(cohortId: number) {
    return await prisma.course.findMany({
      where: { cohortId },
    });
  }

  async getCourseById(id: number) {
    return await prisma.course
      .findUnique({
        where: { id },
        include: {
          cohort: {
            include: {
              program: true,
            },
          },
          enrollments: true,
        },
      })
      .then((course) => {
        if (!course) return null;
        return {
          ...course,
          eligibility: course.cohort?.program?.eligibility || null,
        };
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
