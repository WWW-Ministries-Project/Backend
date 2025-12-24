import { progress_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import { certificateTemplate } from "../../utils/mail_templates/certificateTemplate";
import { sendEmail } from "../../utils";

export class EnrollmentService {
  async enrollUser(payload: { course_id: number; user_id: number }) {
    // Step 1: Validate inputs
    const { course_id, user_id } = payload;
    if (!course_id || !user_id || course_id <= 0 || user_id <= 0) {
      throw new Error("Invalid course_id or user_id.");
    }

    // Step 2: Fetch course details
    const course = await prisma.course.findUnique({
      where: { id: course_id },
      select: {
        id: true,
        enrolled: true,
        capacity: true,
        cohort: {
          select: {
            id: true,
            programId: true,
          },
        },
      },
    });

    if (!course) {
      throw new Error(`Course with ID ${course_id} not found.`);
    }

    if (course.enrolled >= course.capacity) {
      throw new Error(`Course with ID ${course_id} is full.`);
    }

    // Step 3: Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });
    if (!user) {
      throw new Error(`User with ID ${user_id} not found.`);
    }

    // Step 4: Check for existing enrollment
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        user_id_course_id: { user_id, course_id },
      },
    });
    if (existingEnrollment) {
      throw new Error(
        `User ${user_id} is already enrolled in course ${course_id}.`,
      );
    }

    // Step 5: Check prerequisites
    const prerequisites = await prisma.program_prerequisites.findMany({
      where: { programId: course.cohort.programId },
      select: {
        prerequisite: {
          select: {
            id: true,
            title: true,
            topics: {
              select: {
                id: true,
                progress: {
                  where: {
                    enrollment: { user_id },
                    status: "PASS",
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    // Identify incomplete prerequisites
    const incompletePrereqs = prerequisites
      .map((p) => p.prerequisite)
      .filter((prereq) => {
        // A prerequisite is incomplete if it has topics but none have a PASS status for the user
        return (
          prereq.topics.length > 0 &&
          !prereq.topics.some((topic) => topic.progress.length > 0)
        );
      });

    if (incompletePrereqs.length > 0) {
      throw new Error(
        `User must complete prerequisite programs: ${incompletePrereqs
          .map((p) => p.title)
          .join(", ")}`,
      );
    }

    // Step 6: Create enrollment and update course enrollment count
    const [enrollment, _courseUpdate] = await prisma.$transaction([
      prisma.enrollment.create({
        data: {
          user_id,
          course_id,
          enrolledAt: new Date(),
        },
        select: { id: true },
      }),
      prisma.course.update({
        where: { id: course_id },
        data: { enrolled: { increment: 1 } },
      }),
    ]);

    // Step 7: Create progress records for topics in the program
    const topics = await prisma.topic.findMany({
      where: {
        program: {
          cohorts: {
            some: { id: course.cohort.id },
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

    // Step 8: Return the created enrollment
    return prisma.enrollment.findUnique({
      where: { id: enrollment.id },
      include: {
        course: { select: { id: true, name: true } },
        user: { select: { id: true } },
      },
    });
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
    let topics: any = [];
    if (enrollmentData?.course?.cohort?.program?.topics) {
      const progressMap = Object.fromEntries(
        progressData.map((p) => [p.topicId, p]),
      );

      topics = enrollmentData.course.cohort.program.topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        score: progressMap[topic.id]?.score ?? null,
        progressId: progressMap[topic.id]?.id ?? null,
        status: progressMap[topic.id]?.status ?? "PENDING",
        completedAt: progressMap[topic.id]?.completedAt ?? null,
        notes: progressMap[topic.id]?.notes ?? null,
      }));
    }

    return {
      id: enrollmentData.course?.cohort?.program?.id,
      name: enrollmentData.course?.cohort?.program?.title,
      description: enrollmentData.course?.cohort?.program?.description,
      topics,
    };
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

  async completeEnrollment(topicId: number) {
    // const progressStatus = await prisma.progress.update({
    //   where: { id: topicId },
    // })
    // const enrollment = await prisma.enrollment.update({
    //   where: { id: enrollmentId },
    //   data: { completedAt: new Date(), completed: true },
    // });

    
    // return enrollment;
}
}