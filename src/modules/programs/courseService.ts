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
              program: {
                include: {
                  topics: true,
                },
              },
            },
          },
          enrollments: {
            include: {
              user: {
                include: {
                  user_info: true,
                },
              },
              progress: {
                select: {
                  topicId: true,
                  status: true,
                  score: true,
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

        const programTopicIds =
          course.cohort?.program?.topics?.map((t) => t.id) || [];
        const totalTopics = programTopicIds.length;

        const flattenedEnrollments = course.enrollments.map((e: any) => {
          const userInfo = e.user?.user_info;

          const completedCount = e.progress.filter(
            (p: any) =>
              p.status === "PASS" && programTopicIds.includes(p.topicId),
          ).length;
          const progressPercent =
            totalTopics > 0
              ? Math.round((completedCount / totalTopics) * 100)
              : 0;

          return {
            id: e.id,
            user_id: e.user_id,
            course_id: e.course_id,
            enrolled_at: e.enrolledAt,
            first_name: userInfo?.first_name,
            last_name: userInfo?.last_name,
            primary_number: userInfo?.primary_number,
            email: userInfo?.email,

            progress_completed: completedCount,
            progress_total: totalTopics,
            progress_percent: progressPercent,
            progress_status:
              progressPercent === 100 ? "COMPLETED" : "IN_PROGRESS",
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

  async checkIfInstructor(userId: number) {
    const instructorCourses = await prisma.course.findMany({
      where: { instructorId: userId },
    });
    return instructorCourses.length > 0;
  }
}
