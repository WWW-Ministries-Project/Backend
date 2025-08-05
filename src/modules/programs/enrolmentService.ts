import { progress_status } from "@prisma/client";
import { prisma } from "../../Models/context";

export class EnrollmentService {
  async enrollUser(payload: { course_id: number, user_id?: number }) {
    const {  course_id, user_id } = payload;

    const course = await prisma.course.findUnique({
      where: { id: course_id },
      select: { enrolled: true, capacity: true, cohortId: true }, // Get cohortId
    });

    if (!course) {
      throw new Error("Course not found.");
    }

    if (course.enrolled >= course.capacity) {
      throw new Error("Course is full.");
    }

    const userExist = await prisma.user.findFirst({
      where:{id:user_id}
    })
    if (!userExist) {
      throw new Error("Course is full.");
    }

    // Check for duplicate enrollment
    const existingEnrollment = await prisma.enrollment.findFirst({
      where: {
        user_id, course_id
      }
    });

    if (existingEnrollment) {
      throw new Error("User is already enrolled in this course.");
    }

    // Enroll user & update enrolled count in a transaction
    const [enrollment] = await prisma.$transaction([
      prisma.enrollment.create({
        data: {
          user_id,
          course_id,
        },
      }),
      prisma.course.update({
        where: { id: course_id },
        data: { enrolled: { increment: 1 } },
      }),
    ]);

    // Step 3: Auto-Generate Progress for Each Topic
    const topics = await prisma.topic.findMany({
      where: {
        program: {
          cohorts: {
            some: { id: course.cohortId },
          },
        },
      },
      select: { id: true },
    });

    if (topics.length > 0) {
      await prisma.progress.createMany({
        data: topics.map((topic) => ({
          enrollmentId: enrollment.id,
          topicId: topic.id,
          score: 0, // Default score
          status: "PENDING",
        })),
      });
    }

    return enrollment;
  }

  async getEnrollmentsByCourse(courseId: number) {
    return await prisma.enrollment.findMany({
      where: { course_id: courseId },
      include: { user: true },
    });
  }

  async getUserEnrollments(userId: number) {
    return await prisma.enrollment.findMany({
      where: { user_id: userId },
      include: { course: true },
    });
  }

  async unenrollUser(course_id: number, user_id: number) {
    // Remove enrollment
    const enrollment = await prisma.enrollment.delete({
      where: { user_id_course_id: { user_id, course_id } },
    });

    // Update enrolled count
    const course = await prisma.course.findUnique({ where: { id: course_id } });
    if (course) {
      await prisma.course.update({
        where: { id: course_id },
        data: { enrolled: course.enrolled - 1 },
      });
    }

    return enrollment;
  }

async getProgressDetails(enrollmentId: number) {
  const enrollmentData = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          user_info: {
            select: {
              primary_number: true,
              country_code: true,
            },
          },
        },
      },
      course: {
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
        },
      },
    },
  });

  if (!enrollmentData) return null;

  const progressData = await prisma.progress.findMany({
    where: { enrollmentId },
    select: {
      id: true,
      topicId: true,
      score: true,
      status: true,
      notes: true,
      completedAt: true,
    },
  });

  // Map progress data to topics
  if (enrollmentData?.course?.cohort?.program?.topics) {
    const progressMap = Object.fromEntries(
      progressData.map((p) => [p.topicId, p])
    );

    enrollmentData.course.cohort.program.topics =
      enrollmentData.course.cohort.program.topics.map((topic) => ({
        ...topic,
        score: progressMap[topic.id]?.score ?? null,
        progressId: progressMap[topic.id]?.id,
        status: progressMap[topic.id]?.status ?? "PENDING",
        completedAt: progressMap[topic.id]?.completedAt ?? null,
        notes: progressMap[topic.id]?.notes ?? null,
      }));
  }

  const response_data = {
    name:enrollmentData.user?.name,
    email:enrollmentData.user?.email,
    number: enrollmentData.user?.user_info?.primary_number,
    country_code:  enrollmentData.user?.user_info?.country_code,
    ...enrollmentData,
  }

  return response_data;
}

  async updateProgressScore(
    progressId: number,
    score: number,
    status: progress_status,
    notes?: string,
  ) {
    const updatedProgress = await prisma.progress.update({
      where: {
        id: progressId,
      },
      data: {
        score,
        status,
        notes,
      },
    });

    return updatedProgress;
  }

  async updateProgressScores(progressUpdates: []) {
    const updates = await prisma.$transaction(
      progressUpdates.map(({ topicId, enrollmentId, score, status, notes }) =>
        prisma.progress.updateMany({
          where: { topicId, enrollmentId },
          data: { score, status, notes },
        }),
      ),
    );
    return updates;
  }
  async getUserProgramsCoursesTopics(userId: number) {
  return await prisma.enrollment.findMany({
    where: {
      user_id: userId,
    },
    select: {
      id: true,
      enrolledAt: true,
      course: {
        select: {
          id: true,
          name: true,
          cohort: {
            select: {
              id: true,
              name: true,
              program: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  topics: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

}
