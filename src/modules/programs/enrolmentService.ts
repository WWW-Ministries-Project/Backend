import { progress_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import { certificateTemplate } from "../../utils/mail_templates/certificateTemplate";
import { sendEmail } from "../../utils";

export class EnrollmentService {
  async enrollUser(payload: { course_id: number; user_id?: number }) {
    const { course_id, user_id } = payload;

    // Step 1: Get course, cohort, and program
    const course = await prisma.course.findUnique({
      where: { id: course_id },
      select: {
        enrolled: true,
        capacity: true,
        cohortId: true,
        cohort: {
          select: {
            programId: true,
          },
        },
      },
    });

    if (!course) {
      throw new Error("Course not found.");
    }

    if (course.enrolled >= course.capacity) {
      throw new Error("Course is full.");
    }

    const userExist = await prisma.user.findFirst({
      where: { id: user_id },
    });
    if (!userExist) {
      throw new Error("User not found.");
    }

    // Step 2: Check for duplicate enrollment
    const existingEnrollment = await prisma.enrollment.findFirst({
      where: {
        user_id,
        course_id,
      },
    });

    if (existingEnrollment) {
      throw new Error("User is already enrolled in this course.");
    }

    // ✅ Step 3: Optimised prerequisite check
    const incompletePrereqs = await prisma.program_prerequisites.findMany({
      where: {
        programId: course.cohort.programId,
        NOT: {
          prerequisite: {
            cohorts: {
              some: {
                courses: {
                  some: {
                    enrollments: {
                      some: {
                        user_id: user_id,
                        progress: {
                          every: { status: "PASS" }, // completion condition
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: {
        prerequisite: {
          select: { title: true },
        },
      },
    });

    if (incompletePrereqs.length > 0) {
      throw new Error(
        `User must complete prerequisite programs: ${incompletePrereqs
          .map((p) => p.prerequisite.title)
          .join(", ")}`,
      );
    }

    // Step 4: Enroll user & update enrolled count
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

    // Step 5: Auto-generate progress records for topics
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
          score: 0,
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
        progressData.map((p) => [p.topicId, p]),
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
      name: enrollmentData.user?.name,
      email: enrollmentData.user?.email,
      number: enrollmentData.user?.user_info?.primary_number,
      country_code: enrollmentData.user?.user_info?.country_code,
      ...enrollmentData,
    };

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
    const enrollment = await prisma.enrollment.findMany({
      where: {
        user_id: userId,
      },
    });

    if (enrollment && enrollment.length > 0) {
      const progressDetails = await Promise.all(
        enrollment.map((enr) => this.getProgressDetails(enr.id)),
      );
      return progressDetails;
    } else {
      return null;
    }
  }

  async generateCertificate(programId: number, userId: number) {
    const [program, user, topics] = await Promise.all([
      prisma.program.findUnique({
        where: { id: programId },
        select: { id: true, title: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      }),
      prisma.topic.findMany({
        where: { programId },
        select: { id: true },
      }),
    ]);

    if (!program) throw new Error("Program not found");
    if (!user) throw new Error("User not found");
    if (topics.length === 0) throw new Error("Program has no topics");

    const topicIds = topics.map((t) => t.id);

    const passedTopicsCount = await prisma.progress.count({
      where: {
        topicId: { in: topicIds },
        enrollment: { user_id: userId },
        status: "PASS",
      },
    });

    if (passedTopicsCount !== topicIds.length) {
      throw new Error("User has not completed all topics in the program");
    }

    const certificateNumber = `CERT-${programId}-${userId}-${Date.now()}`;

    const certHtml = certificateTemplate(
      user.name,
      certificateNumber,
      program.title,
    );

    const certificate = await prisma.certificate.create({
      data: {
        userId,
        programId,
        issuedAt: new Date(),
        certificateNumber,
      },
    });

    const attachementArray: string[] = [];
    attachementArray.push(certHtml);

    // sendEmailWithAttachmentAsString(
    //   certHtml,
    //   String(user?.email),
    //   "Your Certificate of Completion",
    //   attachementArray,
    // );

    return certificate;
  }
}
