import { max, sub } from "date-fns";
import { prisma } from "../../Models/context";
import { toCapitalizeEachWord } from "../../utils";

export class ProgramService {
  async reorderTopics(
    programId: number,
    topics: Array<{ id: number; order_number: number }>,
  ) {
    return prisma.$transaction(async (tx) => {
      const program = await tx.program.findUnique({
        where: { id: programId },
        select: { id: true },
      });

      if (!program) {
        throw new Error("Program not found");
      }

      const topicIds = topics.map((topic) => topic.id);

      const existingTopics = await tx.topic.findMany({
        where: {
          id: { in: topicIds },
          programId,
        },
        select: { id: true },
      });

      if (existingTopics.length !== topicIds.length) {
        const existingTopicIds = new Set(existingTopics.map((topic) => topic.id));
        const missingTopicIds = topicIds.filter((id) => !existingTopicIds.has(id));

        throw new Error(
          `Topics not found in program: ${missingTopicIds.join(", ")}`,
        );
      }

      for (const topic of topics) {
        await tx.topic.update({
          where: { id: topic.id },
          data: { order_number: topic.order_number },
        });
      }

      return { programId, updatedCount: topics.length };
    });
  }

  async getAllProgramForMember(userId?: number) {
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

    const formattedPrograms = programs
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
          topics: program.topics.map((t) => ({
            name: t.name,
            description: t.description,
          })),
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

    if (!userId) return formattedPrograms;

    const enrollments = await prisma.enrollment.findMany({
      where: {
        user_id: userId,
        course: {
          cohort: {
            programId: {
              in: formattedPrograms.map((program: any) => program.id),
            },
          },
        },
      },
      select: {
        course: {
          select: {
            cohort: {
              select: {
                programId: true,
              },
            },
          },
        },
      },
    });

    const enrolledProgramIds = new Set(
      enrollments.map((enrollment) => enrollment.course.cohort.programId),
    );

    return formattedPrograms.map((program: any) => ({
      ...program,
      enrolled: enrolledProgramIds.has(program.id),
    }));
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
            create: data.topics.map((topic: string, index: number) => ({
              name: topic,
              order_number: index + 1,
            })),
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

  async getAllPrograms(filters?: { page?: number; take?: number }) {
    const shouldPaginate =
      typeof filters?.page === "number" && typeof filters?.take === "number";
    const skip = shouldPaginate ? (filters.page! - 1) * filters.take! : undefined;

    return await prisma.program.findMany({
      skip,
      take: shouldPaginate ? filters?.take : undefined,
      include: {
        topics: true,
        cohorts: true,
        prerequisitePrograms: {
          select: { prerequisiteId: true, prerequisite: true },
        },
      },
    });
  }

  private getEnrollmentCompletionStatus(
    progress: Array<{ status: string; completed: boolean | null }>,
    totalTopics: number,
    enrollmentCompleted?: boolean | null,
  ) {
    const completedTopics = progress.filter(
      (item) => item.completed || item.status === "PASS",
    ).length;
    const normalizedTotalTopics = totalTopics > 0 ? totalTopics : progress.length;
    const percent =
      normalizedTotalTopics > 0
        ? Number(((completedTopics / normalizedTotalTopics) * 100).toFixed(1))
        : 0;

    let status = "NOT_STARTED";
    if (
      enrollmentCompleted === true ||
      (normalizedTotalTopics > 0 && completedTopics >= normalizedTotalTopics)
    ) {
      status = "COMPLETED";
    } else if (completedTopics > 0) {
      status = "IN_PROGRESS";
    }

    return {
      status,
      percent,
      completedTopics,
      totalTopics: normalizedTotalTopics,
    };
  }

  async getAllProgramsWithEnrolledMembersAndCompletion() {
    const programs = await prisma.program.findMany({
      include: {
        topics: {
          orderBy: {
            order_number: "asc",
          },
          include: {
            LearningUnit: true,
          },
        },
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
                instructor: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    member_id: true,
                    user_info: {
                      select: {
                        first_name: true,
                        last_name: true,
                        primary_number: true,
                        country_code: true,
                        photo: true,
                      },
                    },
                  },
                },
                enrollments: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                        member_id: true,
                        is_active: true,
                        membership_type: true,
                        user_info: {
                          select: {
                            first_name: true,
                            last_name: true,
                            other_name: true,
                            primary_number: true,
                            country_code: true,
                            photo: true,
                            country: true,
                            state_region: true,
                            city: true,
                            member_since: true,
                          },
                        },
                      },
                    },
                    progress: {
                      select: {
                        id: true,
                        topicId: true,
                        score: true,
                        status: true,
                        completed: true,
                        completedAt: true,
                        notes: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return programs.map((program) => {
      const totalTopics = program.topics.length;
      const instructorMap = new Map<number, any>();
      const enrolledMemberMap = new Map<number, any>();
      let totalEnrollments = 0;

      const cohorts = program.cohorts.map((cohort) => {
        const courses = cohort.courses.map((course) => {
          if (course.instructor?.id) {
            const existingInstructor = instructorMap.get(course.instructor.id);
            const courseItem = {
              id: course.id,
              name: course.name,
              cohort_id: cohort.id,
              cohort_name: cohort.name,
            };

            if (existingInstructor) {
              existingInstructor.courses.push(courseItem);
            } else {
              instructorMap.set(course.instructor.id, {
                ...course.instructor,
                courses: [courseItem],
              });
            }
          }

          const enrollments = course.enrollments.map((enrollment) => {
            totalEnrollments += 1;
            const completion = this.getEnrollmentCompletionStatus(
              enrollment.progress,
              totalTopics,
              enrollment.completed,
            );

            if (enrollment.user?.id) {
              const existingMember = enrolledMemberMap.get(enrollment.user.id);
              const enrollmentSummary = {
                enrollment_id: enrollment.id,
                course_id: course.id,
                course_name: course.name,
                cohort_id: cohort.id,
                cohort_name: cohort.name,
                instructor: course.instructor
                  ? {
                      id: course.instructor.id,
                      name: course.instructor.name,
                      email: course.instructor.email,
                    }
                  : null,
                enrolled_at: enrollment.enrolledAt,
                completed_at: enrollment.completedAt,
                completion_status: completion.status,
                completion_percent: completion.percent,
                completed_topics: completion.completedTopics,
                total_topics: completion.totalTopics,
              };

              if (existingMember) {
                existingMember.enrollments.push(enrollmentSummary);
              } else {
                enrolledMemberMap.set(enrollment.user.id, {
                  member: enrollment.user,
                  enrollments: [enrollmentSummary],
                });
              }
            }

            return {
              ...enrollment,
              completion_status: completion.status,
              completion_percent: completion.percent,
              completed_topics: completion.completedTopics,
              total_topics: completion.totalTopics,
            };
          });

          return {
            ...course,
            enrollments,
          };
        });

        return {
          ...cohort,
          courses,
        };
      });

      const instructors = Array.from(instructorMap.values()).map((instructor) => ({
        ...instructor,
        courses: instructor.courses.sort(
          (a: { id: number }, b: { id: number }) => a.id - b.id,
        ),
      }));

      const enrolled_members = Array.from(enrolledMemberMap.values()).map(
        (memberEntry) => {
          const enrollments = memberEntry.enrollments.sort(
            (
              a: { enrolled_at: Date | null },
              b: { enrolled_at: Date | null },
            ) => {
              const aTime = a.enrolled_at ? new Date(a.enrolled_at).getTime() : 0;
              const bTime = b.enrolled_at ? new Date(b.enrolled_at).getTime() : 0;
              return bTime - aTime;
            },
          );

          const bestCompletionPercent = enrollments.reduce(
            (maxValue: number, enrollmentItem: { completion_percent: number }) =>
              Math.max(maxValue, enrollmentItem.completion_percent || 0),
            0,
          );
          const hasCompleted = enrollments.some(
            (enrollmentItem: { completion_status: string }) =>
              enrollmentItem.completion_status === "COMPLETED",
          );

          let overallStatus = "NOT_STARTED";
          if (hasCompleted || bestCompletionPercent >= 100) {
            overallStatus = "COMPLETED";
          } else if (bestCompletionPercent > 0) {
            overallStatus = "IN_PROGRESS";
          }

          const fullNameFromInfo = [
            memberEntry.member?.user_info?.first_name,
            memberEntry.member?.user_info?.last_name,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          const fullName =
            fullNameFromInfo || memberEntry.member?.name || "Unknown";
          const latestEnrollment = enrollments[0] ?? null;
          const latestCompletedEnrollment =
            enrollments.find(
              (enrollmentItem: { completed_at: Date | null }) =>
                enrollmentItem.completed_at !== null,
            ) ?? null;
          const memberInstructors = Array.from(
            new Map(
              enrollments
                .filter(
                  (enrollmentItem: {
                    instructor: { id: number | null } | null;
                  }) => enrollmentItem.instructor?.id,
                )
                .map(
                  (enrollmentItem: {
                    instructor: {
                      id: number;
                      name: string | null;
                      email: string | null;
                    };
                  }) => [enrollmentItem.instructor.id, enrollmentItem.instructor],
                ),
            ).values(),
          );

          return {
            ...memberEntry.member,
            user_id: memberEntry.member?.id ?? null,
            full_name: fullName,
            status: overallStatus.toLowerCase(),
            cohort: latestEnrollment
              ? {
                  id: latestEnrollment.cohort_id,
                  name: latestEnrollment.cohort_name,
                }
              : null,
            class: latestEnrollment
              ? {
                  id: latestEnrollment.course_id,
                  name: latestEnrollment.course_name,
                }
              : null,
            instructors: memberInstructors,
            date_enrolled: latestEnrollment?.enrolled_at ?? null,
            date_completed: latestCompletedEnrollment?.completed_at ?? null,
            completion_percentage: Number(bestCompletionPercent.toFixed(1)),
            completion: {
              status: overallStatus,
              percent: Number(bestCompletionPercent.toFixed(1)),
              enrolled_courses_count: enrollments.length,
              completed_courses_count: enrollments.filter(
                (enrollmentItem: { completion_status: string }) =>
                  enrollmentItem.completion_status === "COMPLETED",
              ).length,
              latest_enrolled_at: enrollments[0]?.enrolled_at ?? null,
            },
            enrollments,
          };
        },
      );

      return {
        ...program,
        program_details: {
          id: program.id,
          title: program.title,
          description: program.description,
          member_required: program.member_required,
          leader_required: program.leader_required,
          ministry_required: program.ministry_required,
          completed: program.completed,
          createdAt: program.createdAt,
          updatedAt: program.updatedAt,
        },
        cohorts,
        instructors,
        enrolled_members,
        enrollment_summary: {
          total_topics: totalTopics,
          total_cohorts: cohorts.length,
          total_courses: cohorts.reduce(
            (sum: number, cohort) => sum + cohort.courses.length,
            0,
          ),
          total_enrollments: totalEnrollments,
          total_enrolled_members: enrolled_members.length,
          completed_members: enrolled_members.filter(
            (member) => member.completion.status === "COMPLETED",
          ).length,
          in_progress_members: enrolled_members.filter(
            (member) => member.completion.status === "IN_PROGRESS",
          ).length,
          not_started_members: enrolled_members.filter(
            (member) => member.completion.status === "NOT_STARTED",
          ).length,
        },
      };
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
        topics: {
          include: {
            LearningUnit: true,
          },
        },
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
    const normalizedLearningUnit = this.normalizeLearningUnit(learningUnit);
    this.validateLearningUnit(normalizedLearningUnit);

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
          type: normalizedLearningUnit.type,
          maxAttempts: normalizedLearningUnit.maxAttempts,
          data: normalizedLearningUnit.data,
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
    const normalizedLearningUnit = this.normalizeLearningUnit(learningUnit);
    this.validateLearningUnit(normalizedLearningUnit);

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
          type: normalizedLearningUnit.type,
          maxAttempts: normalizedLearningUnit.maxAttempts,
          data: normalizedLearningUnit.data,
          version: { increment: 1 },
        },
        create: {
          topicId: id,
          type: normalizedLearningUnit.type,
          maxAttempts: normalizedLearningUnit.maxAttempts,
          data: normalizedLearningUnit.data,
        },
      });

      return topic;
    });
  }

  private normalizeLearningUnit(learningUnit: any) {
    if (!learningUnit || typeof learningUnit !== "object") {
      return learningUnit;
    }

    const normalized = {
      ...learningUnit,
      data:
        learningUnit.data && typeof learningUnit.data === "object"
          ? { ...learningUnit.data }
          : learningUnit.data,
    };

    if (
      normalized.maxAttempts === undefined &&
      Number.isInteger(Number(normalized.maxAttempt)) &&
      Number(normalized.maxAttempt) > 0
    ) {
      normalized.maxAttempts = Number(normalized.maxAttempt);
    }

    if (
      normalized.type === "video" &&
      normalized.data &&
      typeof normalized.data === "object" &&
      !normalized.data.url &&
      normalized.data.value
    ) {
      normalized.data.url = normalized.data.value;
    }

    if (
      normalized.type === "live" &&
      normalized.data &&
      typeof normalized.data === "object" &&
      !normalized.data.meetingLink &&
      normalized.data.value
    ) {
      normalized.data.meetingLink = normalized.data.value;
    }

    if (
      normalized.type === "in-person" &&
      normalized.data &&
      typeof normalized.data === "object" &&
      !normalized.data.venue &&
      normalized.data.value
    ) {
      normalized.data.venue = normalized.data.value;
    }

    return normalized;
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
        submissions: true,
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

    return { updatedProgress, submissions: enrollment.submissions.length };
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
      orderBy: {
        enrolledAt: "desc",
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
                        order_number: "asc",
                      },
                      include: {
                        LearningUnit: {
                          include: {
                            cohortAssignments: true,
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
      },
    });

    if (!enrollment) {
      throw new Error("User is not enrolled in this program");
    }

    const program = enrollment.course.cohort.program;
    const cohortId = enrollment.course.cohort.id;

    const topics = program.topics.map((topic) => {
      const activation =
        topic.LearningUnit?.cohortAssignments.find(
          (assignment) => assignment.cohortId === cohortId,
        ) ?? null;
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
              data: this.getLearningUnitResponseData(
                topic.LearningUnit.type,
                topic.LearningUnit.data,
                topic.LearningUnit.maxAttempts,
              ),
              maxAttempts: topic.LearningUnit.maxAttempts,
              version: topic.LearningUnit.version,
            }
          : null,
        activation: activation
          ? {
              isActive: activation.isActive,
              activatedAt: activation.activatedAt,
              dueDate: activation.dueDate,
              closedAt: activation.closedAt,
            }
          : {
              isActive: false,
              activatedAt: null,
              dueDate: null,
              closedAt: null,
            },
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
            program: true,
          },
        },
      },
    });
    return programs;
  }

  async getCohortsByProgram(programId: number) {
    const cohorts = await prisma.cohort.findMany({
      where: { programId },
      include: {
        courses: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    return cohorts;
  }

  async activateAssignmentForCohort(
    cohortId: number,
    topicId: number,
    dueDate?: string,
  ) {
    const learningUnit = await prisma.learningUnit.findUnique({
      where: { topicId },
    });

    if (!learningUnit) {
      throw new Error("No learning unit found for this topic");
    }

    if (!learningUnit.type.startsWith("assignment")) {
      throw new Error("Only assignment learning units can be activated");
    }

    return prisma.cohort_assignment.upsert({
      where: {
        cohortId_learningUnitId: {
          cohortId,
          learningUnitId: learningUnit.id,
        },
      },
      update: {
        isActive: true,
        activatedAt: new Date(),
        dueDate: new Date(dueDate!),
        closedAt: null,
      },
      create: {
        cohortId,
        learningUnitId: learningUnit.id,
        isActive: true,
        activatedAt: new Date(),
        dueDate,
      },
    });
  }

  async deactivateAssignmentForCohort(cohortId: number, topicId: number) {
    const learningUnit = await prisma.learningUnit.findUnique({
      where: { topicId },
    });

    if (!learningUnit) {
      throw new Error("No learning unit found for this topic");
    }

    if (!learningUnit.type.startsWith("assignment")) {
      throw new Error("Only assignment learning units can be deactivated");
    }

    const existing = await prisma.cohort_assignment.findUnique({
      where: {
        cohortId_learningUnitId: {
          cohortId,
          learningUnitId: learningUnit.id,
        },
      },
    });

    if (!existing || !existing.isActive) {
      throw new Error("Assignment is not currently active for this cohort");
    }

    return prisma.cohort_assignment.update({
      where: {
        cohortId_learningUnitId: {
          cohortId,
          learningUnitId: learningUnit.id,
        },
      },
      data: {
        isActive: false,
        closedAt: new Date(),
      },
    });
  }

  async isAssignmentActiveForCohort(cohortId: number, topicId: number) {
    const learningUnit = await prisma.learningUnit.findUnique({
      where: { topicId },
      select: { id: true, type: true },
    });

    if (!learningUnit || !learningUnit.type.startsWith("assignment")) {
      return false;
    }

    const assignment = await prisma.cohort_assignment.findUnique({
      where: {
        cohortId_learningUnitId: {
          cohortId,
          learningUnitId: learningUnit.id,
        },
      },
    });

    return !!assignment?.isActive;
  }

  async submitMCQAssignment(
    userId: number,
    programId: number,
    topicId: number,
    answers: Record<string, string>,
  ) {
    const learningUnit = await prisma.learningUnit.findUnique({
      where: { topicId },
      include: {
        topic: {
          select: { programId: true },
        },
      },
    });

    if (!learningUnit || !learningUnit.type.startsWith("assignment")) {
      throw new Error("No MCQ assignment found for this topic");
    }

    if (learningUnit.topic.programId !== programId) {
      throw new Error("Topic does not belong to the provided program");
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        user_id: userId,
        course: {
          cohort: {
            programId,
          },
        },
      },
      orderBy: {
        enrolledAt: "desc",
      },
      include: {
        course: {
          include: {
            cohort: true,
          },
        },
      },
    });

    if (enrollments.length === 0) {
      throw new Error("User is not enrolled in this program");
    }

    const cohortIds = [...new Set(enrollments.map((item) => item.course.cohortId))];

    const cohortAssignments = await prisma.cohort_assignment.findMany({
      where: {
        cohortId: { in: cohortIds },
        learningUnitId: learningUnit.id,
      },
      orderBy: [{ activatedAt: "desc" }, { id: "desc" }],
    });

    if (cohortAssignments.length === 0) {
      throw new Error("Assignment has not been activated for your cohort");
    }

    const now = new Date();

    const activeAssignment = cohortAssignments.find(
      (assignment) =>
        assignment.isActive &&
        assignment.closedAt === null &&
        (!assignment.dueDate || assignment.dueDate >= now),
    );

    if (!activeAssignment) {
      const expiredAssignment = cohortAssignments.find(
        (assignment) =>
          assignment.isActive &&
          assignment.closedAt === null &&
          assignment.dueDate !== null &&
          assignment.dueDate < now,
      );

      if (expiredAssignment) {
        const expiredEnrollment =
          enrollments.find(
            (item) => item.course.cohortId === expiredAssignment.cohortId,
          ) ?? enrollments[0];

        await this.markUnsubmittedAssignmentAsExpired(
          expiredEnrollment.id,
          learningUnit.id,
          topicId,
        );
        throw new Error("Assignment due date has passed");
      }

      throw new Error("Assignment is not active for your cohort");
    }

    const enrollment =
      enrollments.find(
        (item) => item.course.cohortId === activeAssignment.cohortId,
      ) ?? enrollments[0];

    const previousSubmissions = await prisma.assignment_submission.findMany({
      where: {
        enrollmentId: enrollment.id,
        learningUnitId: learningUnit.id,
      },
    });

    const { maxAttempts, passMark } = this.getAssignmentConfig(learningUnit);
    const currentAttempt = previousSubmissions.length + 1;
    if (currentAttempt > maxAttempts) {
      throw new Error(`Maximum attempts of ${maxAttempts} exceeded`);
    }

    const questions = (learningUnit?.data as any)?.questions as any[];
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("Assignment questions are not configured");
    }

    let score = 0;

    for (const question of questions) {
      const userAnswer = answers[question.id];
      if (userAnswer && userAnswer === question.correctOptionId) {
        score += 1;
      }
    }
    const totalQuestions = questions.length;
    const percentageScore = (score / questions.length) * 100;

    const submission = await prisma.assignment_submission.create({
      data: {
        enrollmentId: enrollment.id,
        learningUnitId: learningUnit.id,
        content: JSON.stringify(answers),
        attempt: currentAttempt,
        status: "GRADED",
        score,
        gradedAt: new Date(),
      },
    });

    await prisma.progress.upsert({
      where: {
        enrollmentId_topicId: {
          enrollmentId: enrollment.id,
          topicId,
        },
      },
      update: {
        score: percentageScore,
        status: percentageScore >= passMark ? "PASS" : "FAIL",
        completed: true,
        completedAt: new Date(),
      },
      create: {
        enrollmentId: enrollment.id,
        topicId,
        score: percentageScore,
        status: percentageScore >= passMark ? "PASS" : "FAIL",
        completed: true,
        completedAt: new Date(),
      },
    });

    return {
      submissionId: submission.id,
      attempt: currentAttempt,
      score,
      totalQuestions,
      percentageScore,
      maxAttempts,
      passMark,
    };
  }

  async getAssignmentResults(
    topicId: number,
    filters?: {
      cohortId?: number;
      programId?: number;
    },
  ) {
    // 1️⃣ Resolve learning unit
    const learningUnit = await prisma.learningUnit.findUnique({
      where: { topicId },
    });

    if (!learningUnit) {
      throw new Error("Learning unit not found for this topic");
    }

    if (!learningUnit.type.startsWith("assignment")) {
      throw new Error("This topic is not an assignment");
    }

    // 2️⃣ Build dynamic enrollment filter
    const enrollmentWhere: any = {};

    if (filters?.cohortId) {
      enrollmentWhere.course = {
        cohortId: filters.cohortId,
      };
    }

    if (filters?.programId) {
      enrollmentWhere.course = {
        ...(enrollmentWhere.course ?? {}),
        cohort: {
          programId: filters.programId,
        },
      };
    }

    // 3️⃣ Fetch enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        submissions: {
          where: {
            learningUnitId: learningUnit.id,
          },
          orderBy: {
            attempt: "desc",
          },
        },
        progress: {
          where: {
            topicId,
          },
        },
      },
    });

    return enrollments.map((enrollment) => {
      const latestSubmission = enrollment.submissions[0] ?? null;
      const progress = enrollment.progress[0] ?? null;

      return {
        student: {
          id: enrollment.user?.id,
          name: `${enrollment.user?.name ?? ""}`,
          email: enrollment.user?.email,
        },

        submission: latestSubmission
          ? {
              id: latestSubmission.id,
              attempt: latestSubmission.attempt,
              score: latestSubmission.score,
              status: latestSubmission.status,
              submittedAt: latestSubmission.submittedAt,
            }
          : null,

        progress: progress
          ? {
              score: progress.score,
              status: progress.status,
              completed: progress.completed,
              completedAt: progress.completedAt,
            }
          : {
              score: null,
              status: "PENDING",
              completed: false,
            },
      };
    });
  }

  async getAssignmentsForCohort(cohortId: number) {
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, programId: true },
    });

    if (!cohort) {
      throw new Error("Cohort not found");
    }

    const learningUnits = await prisma.learningUnit.findMany({
      where: {
        type: {
          startsWith: "assignment",
        },
        topic: {
          programId: cohort.programId,
        },
      },
      include: {
        topic: true,
        cohortAssignments: {
          where: {
            cohortId: cohort.id,
          },
        },
      },
      orderBy: {
        topic: {
          order_number: "asc",
        },
      },
    });

    return learningUnits.map((lu) => {
      const activation = lu.cohortAssignments[0] ?? null;

      return {
        learningUnitId: lu.id,
        type: lu.type,
        version: lu.version,

        topic: {
          id: lu.topic.id,
          name: lu.topic.name,
          description: lu.topic.description,
          order: lu.topic.order_number,
        },

        activation: activation
          ? {
              isActive: activation.isActive,
              activatedAt: activation.activatedAt,
              dueDate: activation.dueDate,
              closedAt: activation.closedAt,
            }
          : {
              isActive: false,
              activatedAt: null,
              dueDate: null,
              closedAt: null,
            },
      };
    });
  }

  private getAssignmentConfig(learningUnit: {
    data: any;
    maxAttempts: number | null;
  }) {
    const data =
      learningUnit.data &&
      typeof learningUnit.data === "object" &&
      !Array.isArray(learningUnit.data)
        ? learningUnit.data
        : {};

    const rawPassMark = data.passMark ?? data.pass_mark ?? data.passmark;
    const parsedPassMark = Number(rawPassMark);
    const passMark =
      Number.isFinite(parsedPassMark) && parsedPassMark >= 0
        ? parsedPassMark
        : 50;

    const dataMaxAttempts = Number(data.maxAttempt ?? data.maxAttempts);
    const maxAttempts =
      typeof learningUnit.maxAttempts === "number" && learningUnit.maxAttempts > 0
        ? learningUnit.maxAttempts
        : Number.isInteger(dataMaxAttempts) && dataMaxAttempts > 0
          ? dataMaxAttempts
        : 3;

    return { maxAttempts, passMark };
  }

  private getLearningUnitResponseData(
    type: string,
    data: any,
    maxAttempts: number | null,
  ) {
    if (!type.startsWith("assignment")) {
      return data;
    }

    const normalizedData =
      data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
    const assignmentConfig = this.getAssignmentConfig({
      data: normalizedData,
      maxAttempts,
    });

    return {
      ...normalizedData,
      maxAttempt: assignmentConfig.maxAttempts,
      maxAttempts: assignmentConfig.maxAttempts,
      passMark: assignmentConfig.passMark,
    };
  }

  private async markUnsubmittedAssignmentAsExpired(
    enrollmentId: number,
    learningUnitId: number,
    topicId: number,
  ) {
    const submissionCount = await prisma.assignment_submission.count({
      where: {
        enrollmentId,
        learningUnitId,
      },
    });

    if (submissionCount > 0) {
      return;
    }

    await prisma.progress.upsert({
      where: {
        enrollmentId_topicId: {
          enrollmentId,
          topicId,
        },
      },
      update: {
        score: 0,
        status: "FAIL",
        completed: true,
        completedAt: new Date(),
      },
      create: {
        enrollmentId,
        topicId,
        score: 0,
        status: "FAIL",
        completed: true,
        completedAt: new Date(),
      },
    });
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
