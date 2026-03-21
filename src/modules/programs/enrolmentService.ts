import { Prisma, progress_status } from "@prisma/client";
import { randomInt } from "crypto";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  ResourceDuplicationError,
} from "../../utils/custom-error-handlers";
import { generateQRDataUrl } from "../../utils";

type CompletedProgramContext = {
  program: {
    id: number;
    title: string;
    topics: Array<{ id: number }>;
  };
  user: {
    id: number;
    name: string;
  };
  completionDate: Date;
};

type ProgramCertificatePayload = {
  recipientFullName: string;
  programTitle: string;
  completionDate: string;
  issueDate: string;
  certificateNumber: string;
  verificationUrl: string;
  qrCodeDataUrl: string;
};

const CERTIFICATE_NUMBER_PREFIX = "WWMHCSM";
const CERTIFICATE_NUMBER_MIN = 100000;
const CERTIFICATE_NUMBER_MAX = 1000000;
const CERTIFICATE_VERIFICATION_PATH = "/certificate/verify";

export class EnrollmentService {
  async enrollUser(payload: { course_id: number; user_id: number }) {
    // Step 1: Validate inputs
    const { course_id, user_id } = payload;
    if (!course_id || !user_id || course_id <= 0 || user_id <= 0) {
      throw new InputValidationError("Please provide a valid user and course");
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
      throw new NotFoundError("The selected course was not found");
    }

    // Step 3: Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });
    if (!user) {
      throw new NotFoundError("The selected user was not found");
    }

    // Step 4: Ensure the user is not already enrolled in this program
    const existingEnrollmentInProgram = await prisma.enrollment.findFirst({
      where: {
        user_id,
        course: {
          cohort: {
            programId: course.cohort.programId,
          },
        },
      },
      select: { id: true },
    });
    if (existingEnrollmentInProgram) {
      throw new ResourceDuplicationError(
        "The user has already enrolled in this program",
      );
    }

    if (course.enrolled >= course.capacity) {
      throw new ResourceDuplicationError(
        "This course is full. Please choose a different course",
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
      throw new InputValidationError(
        `Please complete these programs first: ${incompletePrereqs
          .map((p) => p.title)
          .join(", ")}`,
      );
    }

    // Step 6: Create enrollment and update course enrollment count
    let enrollment: { id: number };
    try {
      const [createdEnrollment] = await prisma.$transaction([
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
      enrollment = createdEnrollment;
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ResourceDuplicationError(
          "The user has already enrolled in this program",
        );
      }
      throw error;
    }

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
    const enrollments = await prisma.enrollment.findMany({
      where: { user_id: userId },
      include: {
        course: {
          include: {
            cohort: {
              include: {
                program: {
                  select: {
                    id: true,
                    title: true,
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
        },
      },
    });

    return enrollments.map((e) => ({
      id: e.id,
      user_id: e.user_id,
      course_id: e.course_id,
      enrolledAt: e.enrolledAt,
      completed: e.completed,
      completedAt: e.completedAt,
      instructor: e.course.instructor,
      cohort: {
        id: e.course.cohort.id,
        name: e.course.cohort.name,
        status: e.course.cohort.status,
        startDate: e.course.cohort.startDate,
        duration: e.course.cohort.duration,
      },
      program: e.course.cohort.program,
      course: {
        id: e.course.id,
        name: e.course.name,
        schedule: e.course.schedule,
        classFormat: e.course.classFormat,
        location: e.course.location,
        meetingLink: e.course.meetingLink,
      },
    }));
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

  private buildCertificateVerificationUrl(certificateNumber: string) {
    const frontendBaseUrl = String(process.env.Frontend_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const verificationPath = `${CERTIFICATE_VERIFICATION_PATH}/${encodeURIComponent(
      certificateNumber,
    )}`;

    return frontendBaseUrl
      ? `${frontendBaseUrl}${verificationPath}`
      : verificationPath;
  }

  private generateCertificateNumberCandidate() {
    return `${CERTIFICATE_NUMBER_PREFIX}${randomInt(
      CERTIFICATE_NUMBER_MIN,
      CERTIFICATE_NUMBER_MAX,
    )}`;
  }

  private async resolveProgramCompletionContext(
    programId: number,
    userId: number,
  ): Promise<CompletedProgramContext> {
    const [program, user, enrollment] = await Promise.all([
      prisma.program.findUnique({
        where: { id: programId },
        select: {
          id: true,
          title: true,
          topics: {
            select: {
              id: true,
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true },
      }),
      prisma.enrollment.findFirst({
        where: {
          user_id: userId,
          course: {
            cohort: {
              programId,
            },
          },
        },
        select: {
          id: true,
          completed: true,
          completedAt: true,
          progress: {
            select: {
              topicId: true,
              status: true,
              completedAt: true,
            },
          },
        },
      }),
    ]);

    if (!program) throw new NotFoundError("Program not found");
    if (!user) throw new NotFoundError("User not found");
    if (!enrollment) {
      throw new NotFoundError("User is not enrolled in this program");
    }
    if (program.topics.length === 0) {
      throw new InputValidationError("Program has no topics");
    }

    const passedTopicIds = new Set(
      enrollment.progress
        .filter((progress) => progress.status === "PASS")
        .map((progress) => progress.topicId),
    );

    if (passedTopicIds.size !== program.topics.length) {
      throw new InputValidationError(
        "User has not completed all topics in the program",
      );
    }

    const latestCompletedTopicDate = enrollment.progress.reduce<Date | null>(
      (latestDate, progress) => {
        if (!progress.completedAt) {
          return latestDate;
        }

        if (!latestDate || progress.completedAt > latestDate) {
          return progress.completedAt;
        }

        return latestDate;
      },
      null,
    );

    const completionDate =
      enrollment.completedAt ?? latestCompletedTopicDate ?? new Date();

    if (!enrollment.completed || !enrollment.completedAt) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          completed: true,
          completedAt: completionDate,
        },
      });
    }

    return {
      program,
      user,
      completionDate,
    };
  }

  private async ensureCertificateRecord(programId: number, userId: number) {
    const existingCertificate = await prisma.certificate.findUnique({
      where: {
        userId_programId: {
          userId,
          programId,
        },
      },
    });

    if (existingCertificate) {
      return existingCertificate;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return await prisma.certificate.create({
          data: {
            userId,
            programId,
            issuedAt: new Date(),
            certificateNumber: this.generateCertificateNumberCandidate(),
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const createdCertificate = await prisma.certificate.findUnique({
            where: {
              userId_programId: {
                userId,
                programId,
              },
            },
          });

          if (createdCertificate) {
            return createdCertificate;
          }

          continue;
        }

        throw error;
      }
    }

    throw new Error("Unable to generate a unique certificate number");
  }

  private async buildCertificatePayload(
    context: CompletedProgramContext,
    certificate: {
      issuedAt: Date;
      certificateNumber: string;
    },
  ): Promise<ProgramCertificatePayload> {
    const verificationUrl = this.buildCertificateVerificationUrl(
      certificate.certificateNumber,
    );
    const qrCodeDataUrl = await generateQRDataUrl(verificationUrl);

    return {
      recipientFullName: context.user.name,
      programTitle: context.program.title,
      completionDate: context.completionDate.toISOString(),
      issueDate: certificate.issuedAt.toISOString(),
      certificateNumber: certificate.certificateNumber,
      verificationUrl,
      qrCodeDataUrl,
    };
  }

  async getProgramCertificate(programId: number, userId: number) {
    const completionContext = await this.resolveProgramCompletionContext(
      programId,
      userId,
    );
    const certificate = await this.ensureCertificateRecord(programId, userId);

    return this.buildCertificatePayload(completionContext, certificate);
  }

  async verifyCertificate(certificateNumber: string) {
    const normalizedCertificateNumber = certificateNumber.trim().toUpperCase();
    if (!normalizedCertificateNumber) {
      throw new InputValidationError("Certificate number is required");
    }

    const certificate = await prisma.certificate.findUnique({
      where: {
        certificateNumber: normalizedCertificateNumber,
      },
      select: {
        issuedAt: true,
        certificateNumber: true,
        programId: true,
        userId: true,
      },
    });

    if (!certificate) {
      throw new NotFoundError("Certificate not found");
    }

    const completionContext = await this.resolveProgramCompletionContext(
      certificate.programId,
      certificate.userId,
    );

    return this.buildCertificatePayload(completionContext, certificate);
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
