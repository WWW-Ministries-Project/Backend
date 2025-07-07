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

  async createCourse(data: any) {
    return await prisma.course.create({
      data: {
        name: data.name,
        instructorId: Number(data.instructorId),
        capacity: data.capacity,
        schedule: data.schedule,
        classFormat: data.classFormat,
        location: data.location,
        meetingLink: data.meetingLink,
        cohortId: Number(data.cohortId),
      },
    });
  }

  async getAllCourses(cohortId: number) {
    return await prisma.course.findMany({
      where: { cohortId },
      include : {
        instructor: {
          select: {
            name : true,
            id : true
          }
        } 
      }
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
          instructor:{
            select:{
              id : true,
              name : true
            }
          }
        },
      })
      .then((course) => {
        if (!course) return null;
        return {
          ...course,
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
