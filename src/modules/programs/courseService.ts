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
      include: {
        instructor: {
          select: {
            name: true,
            id: true,
          },
        },
      },
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
          enrollments: {
            include: {
              user: {
                include: {
                  user_info: true,
                },
              },
            },
          },
          instructor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
      .then((course) => {
        if (!course) return null;

        const flattenedEnrollments = course.enrollments.map((enrollment) => {
          const userInfo = enrollment.user?.user_info;
          return {
            id: enrollment.id,
            user_id: enrollment.user_id,
            course_id: enrollment.course_id,
            enrolled_at: enrollment.enrolledAt,
            first_name: userInfo?.first_name,
            last_name: userInfo?.last_name,
            primary_number: userInfo?.primary_number,
            email: userInfo?.email,
          };
        });

        return {
          ...course,
          enrollments: flattenedEnrollments,
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
