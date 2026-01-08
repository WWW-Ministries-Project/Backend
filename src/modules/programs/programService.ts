import { prisma } from "../../Models/context";
import { toCapitalizeEachWord } from "../../utils";

export class ProgramService {
  async getAllProgramForMember() {
    const programs = await prisma.program.findMany({
      where: {
        completed: false,
        cohorts: {
          some: {
            status: { in: ["Ongoing", "Upcoming"] },
          },
        },
      },
      include: {
        topics: true,
        prerequisitePrograms: {
          select: {
            prerequisite: { select: { title: true } },
          },
        },
        cohorts: {
          where: {
            status: { in: ["Ongoing", "Upcoming"] },
          },
          include: {
            courses: {
              include: {
                instructor: true,
              },
            },
          },
          orderBy: { startDate: "asc" },
        },
      },
    });

    return programs
      .map((program) => {
        // Pick preferred cohort: ongoing first, otherwise upcoming
        const ongoingCohort = program.cohorts.find(
          (c) => c.status === "Ongoing",
        );
        const upcomingCohort = program.cohorts.find(
          (c) => c.status === "Upcoming",
        );
        const selectedCohort = ongoingCohort || upcomingCohort;

        if (!selectedCohort) return null; // skip programs with no matching cohort

        return {
          id: program.id,
          name: program.title,
          upcomingCohort: selectedCohort.name,
          topics: program.topics.map((t) => t.name),
          member_required: program.member_required,
          leader_required: program.leader_required,
          ministry_required: program.ministry_required,
          description: program.description,
          prerequisites: program.prerequisitePrograms.map(
            (p) => p.prerequisite.title,
          ),
          courses: selectedCohort.courses.map((course) => ({
            id: course.id,
            name: course.name,
            meetingDays: this.parseMeetingDays(course.schedule),
            meetingTime: this.parseMeetingTime(course.schedule),
            facilitator: course.instructor ? course.instructor.name : "TBA",
            enrolled: course.enrolled,
            capacity: course.capacity,
          })),
        };
      })
      .filter(Boolean); // remove nulls
  }

  // Helpers to parse schedule string into meetingDays/meetingTime
  private parseMeetingDays(schedule: string) {
    // example: "Mon,Wed,Fri 6:00 PM – 8:30 PM"
    return schedule.split(" ")[0].split(",");
  }

  private parseMeetingTime(schedule: string) {
    return schedule.split(" ").slice(1).join(" ");
  }

  async createProgram(data: any) {
    return await prisma.$transaction(async (prisma) => {
      // Step 1: Validate prerequisites
      if (data.prerequisites && data.prerequisites.length > 0) {
        const existingPrerequisites = await prisma.program.findMany({
          where: {
            id: { in: data.prerequisites.map((p: any) => Number(p)) },
          },
          select: { id: true },
        });

        const foundIds = existingPrerequisites.map((p) => p.id);

        const missingPrerequisites = data.prerequisites
          .map((p: number | string) => Number(p))
          .filter((id: number) => !foundIds.includes(id));

        if (missingPrerequisites.length > 0) {
          throw new Error(
            `Missing prerequisites: ${missingPrerequisites.join(", ")}`,
          );
        }
      }

      const existingProgram = await prisma.program.findFirst({
        where: { title: toCapitalizeEachWord(data.title) },
      });

      // Step 2: Check for existing program with same title
      if (existingProgram) {
        throw new Error("Program with this title already exists.");
      }

      // Step 2: Create the program
      const createdProgram = await prisma.program.create({
        data: {
          title: toCapitalizeEachWord(data.title),
          description: data.description,
          member_required: data.member_required,
          leader_required: data.leader_required,
          ministry_required: data.ministry_required,
          topics: {
            create: data.topics.map((topic: string, index: number) => ({ name: topic, order_number: index + 1 })),
          },
        },
        include: { topics: true },
      });

      // Step 3: Add prerequisites
      if (data.prerequisites && data.prerequisites.length > 0) {
        await prisma.program_prerequisites.createMany({
          data: data.prerequisites.map((prerequisiteId: number | string) => ({
            programId: createdProgram.id,
            prerequisiteId: Number(prerequisiteId),
          })),
        });
      }

      // Step 4: Return the full program with prerequisites
      return await prisma.program.findUnique({
        where: { id: createdProgram.id },
        include: {
          prerequisitePrograms: {
            select: { prerequisiteId: true, prerequisite: true },
          },
        },
      });
    });
  }

  async getAllPrograms() {
    return await prisma.program.findMany({
      include: {
        topics: true,
        cohorts: true,
        prerequisitePrograms: {
          select: { prerequisiteId: true, prerequisite: true },
        },
      },
    });
  }

  async getAllTopics() {
    return await prisma.topic.findMany({
      include: {
        program: true,
        LearningUnit: true,
      },
    });
  } 

  async getProgramById(id: number) {
    return await prisma.program.findUnique({
      where: { id },
      include: {
        topics: true,
        prerequisitePrograms: {
          select: {
            prerequisiteId: true,
            prerequisite: true,
          },
        },
        cohorts: {
          include: {
            courses: {
              include: {
                enrollments: true,
              },
            },
          },
        },
      },
    });
  }

  async updateProgram(id: number, data: any) {
    return await prisma.$transaction(async (prisma) => {
      const updatedProgram = await prisma.program.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          member_required: data.member_required,
          leader_required: data.leader_required,
          ministry_required: data.ministry_required,
        },
        include: { topics: true },
      });

      if (data.prerequisites) {
        await prisma.program_prerequisites.deleteMany({
          where: { programId: Number(id) },
        });

        if (data.prerequisites.length > 0) {
          await prisma.program_prerequisites.createMany({
            data: data.prerequisites.map((prerequisiteId: number | string) => ({
              programId: id,
              prerequisiteId: Number(prerequisiteId),
            })),
          });
        }
      }

      return await prisma.program.findUnique({
        where: { id },
        include: {
          topics: true,
          prerequisitePrograms: {
            include: { prerequisite: true },
          },
        },
      });
    });
  }

  async deleteProgram(id: number) {
    return await prisma.program.delete({
      where: { id },
    });
  }

  async createTopic(
    programId: number,
    name: string,
    description: string,
    learningUnit: any,
  ) {
    this.validateLearningUnit(learningUnit);

    return prisma.$transaction(async (tx) => {
      const lastTopic = await tx.topic.findFirst({
        where: { programId },
        orderBy: { order_number: "desc" },
        select: { order_number: true },
      });

      const nextOrderNumber = lastTopic ? (lastTopic.order_number ?? 0) + 1 : 1;

      const topic = await tx.topic.create({
        data: {
          name,
          description,
          programId,
          order_number: nextOrderNumber,
        },
      });

      await tx.learningUnit.create({
        data: {
          topicId: topic.id,
          type: learningUnit.type,
          data: learningUnit.data,
        },
      });

      const enrollments = await tx.enrollment.findMany({
        where: {
          course: {
            cohort: {
              programId,
            },
          },
        },
        select: { id: true },
      });

      if (enrollments.length > 0) {
        await tx.progress.createMany({
          data: enrollments.map((e) => ({
            enrollmentId: e.id,
            topicId: topic.id,
            score: 0,
          })),
        });
      }

      return topic;
    });
  }

  async updateTopic(
    id: number,
    name: string,
    description: string,
    learningUnit: any,
  ) {
    this.validateLearningUnit(learningUnit);

    return prisma.$transaction(async (tx) => {
      // 1️⃣ Update topic
      const topic = await tx.topic.update({
        where: { id },
        data: {
          name: name,
          description: description,
        },
      });

      // 2️⃣ Replace learning unit
      await tx.learningUnit.upsert({
        where: { topicId: id },
        update: {
          type: learningUnit.type,
          data: learningUnit.data,
          version: { increment: 1 },
        },
        create: {
          topicId: id,
          type: learningUnit.type,
          data: learningUnit.data,
        },
      });

      return topic;
    });
  }

  async deleteTopic(topicId: number) {
    await prisma.$transaction(async (tx) => {
      const topic = await tx.topic.findUnique({
        where: { id: topicId },
        select: { programId: true, order_number: true },
      });

      if (!topic) return;

      await tx.progress.deleteMany({
        where: { topicId },
      });

      await tx.topic.delete({
        where: { id: topicId },
      });

      // Shift topics after this one up
      if (topic.order_number !== null) {
        await tx.topic.updateMany({
          where: {
            programId: topic.programId,
            order_number: { gt: topic.order_number },
          },
          data: {
            order_number: { decrement: 1 },
          },
        });
      }
    });
  }

  //get topic
  async getTopic(topicId: number) {
    return await prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        LearningUnit: true,
      },
    });
  }

  async completeTopicByUserAndTopic(userId: number, topicId: number) {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        user_id: userId,
        course: {
          cohort: {
            program: {
              topics: {
                some: { id: topicId },
              },
            },
          },
        },
      },
      include: {
        progress: {
          where: { topicId },
        },
      },
    });

    if (!enrollment) {
      throw new Error("User is not enrolled in this program");
    }

    if (enrollment.progress.length === 0) {
      throw new Error("Progress not initialized for this topic");
    }

    const updatedProgress = await prisma.progress.update({
      where: {
        enrollmentId_topicId: {
          enrollmentId: enrollment.id,
          topicId,
        },
      },
      data: {
        completed: true,
        status: "PASS",
        completedAt: new Date(),
      },
    });

    const remaining = await prisma.progress.count({
      where: {
        enrollmentId: enrollment.id,
        completed: false,
      },
    });

    if (remaining === 0) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          completed: true,
          completedAt: new Date(),
        },
      });
    }

    return updatedProgress;
  }

  async getUserProgramWithProgressAndLearningUnit(
    userId: number,
    programId: number,
  ) {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        user_id: userId,
        course: {
          cohort: {
            programId,
          },
        },
      },
      include: {
        progress: true,
        course: {
          include: {
            cohort: {
              include: {
                program: {
                  include: {
                    topics: {
                      orderBy: {
                      order_number: 'asc',
                    },
                      include: {
                        LearningUnit: true,
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

    if (!enrollment) {
      throw new Error("User is not enrolled in this program");
    }

    const program = enrollment.course.cohort.program;

    const topics = program.topics.map((topic) => {
      const progress = enrollment.progress.find((p) => p.topicId === topic.id);

      return {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        completed: progress?.completed ?? false,
        status: progress?.status ?? "PENDING",
        order_number: topic.order_number,
        completedAt: progress?.completedAt ?? null,
        score: progress?.score ?? 0,
        learningUnit: topic.LearningUnit
          ? {
              id: topic.LearningUnit.id,
              type: topic.LearningUnit.type,
              data: topic.LearningUnit.data,
              version: topic.LearningUnit.version,
            }
          : null,
      };
    });

    return {
      id: program.id,
      title: program.title,
      description: program.description,
      completed: enrollment.completed ?? false,
      topics,
    };
  }

  async getProgramsByInstructor(instructorId: number) {
    const programs = await prisma.course.findMany({
      where: { instructorId },
      include: {
        cohort: {
          include: {
            program: true
          }
        }
      }
    })
    return programs
  }

  async getCohortsByProgram(programId: number) {
    const cohorts = await prisma.cohort.findMany({
      where: { programId },
    });
    return cohorts;
  }

  private validateLearningUnit(learningUnit: any) {
    if (!learningUnit?.type || !learningUnit?.data) {
      throw new Error("Invalid learning unit payload");
    }

    switch (learningUnit.type) {
      case "video":
        if (!learningUnit.data.url) throw new Error("Video URL required");
        break;

      case "live":
        if (!learningUnit.data.meetingLink)
          throw new Error("Meeting link required");
        break;

      case "in-person":
        if (!learningUnit.data.venue) throw new Error("Venue required");
        break;

      case "pdf":
      case "ppt":
        if (!learningUnit.data.link) throw new Error("Document link required");
        break;

      case "lesson-note":
        if (!learningUnit.data.content)
          throw new Error("Lesson content required");
        break;

      case "assignment":
        this.validateMCQAssignment(learningUnit.data);
        break;

      case "assignment-essay":
        if (!learningUnit.data.question)
          throw new Error("Essay question required");
        break;

      default:
        throw new Error(`Unsupported learning unit type: ${learningUnit.type}`);
    }
  }

  private validateMCQAssignment(data: any) {
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error("Assignment must have questions");
    }

    for (const q of data.questions) {
      if (q.options.length < 2) {
        throw new Error("Each question must have at least 2 options");
      }

      const optionIds = q.options.map((o: any) => o.id);
      if (!optionIds.includes(q.correctOptionId)) {
        throw new Error("correctOptionId must match an option");
      }
    }
  }
}
