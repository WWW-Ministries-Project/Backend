import { prisma } from "../../Models/context";

export class CohortService {
  async createCohort(programId: number, data: any) {
    const createdData = await prisma.cohort.create({
      data: {
        name: data.name,
        startDate: new Date(data.startDate),
        status: data.status,
        description: data.description,
        duration: data.duration,
        applicationDeadline: new Date(data.applicationDeadline),
        programId,
      },
    });

    return addDeadlineFlag(createdData);
  }

  async getAllCohortsByProgramID(programId: number) {
    const cohorts = await prisma.cohort.findMany({
      where: { programId },
      include: { courses: true },
    });
    return cohorts.map(addDeadlineFlag);
  }

  async getAllCohorts(filters?: { page?: number; take?: number }) {
    const shouldPaginate =
      typeof filters?.page === "number" && typeof filters?.take === "number";
    const skip = shouldPaginate ? (filters.page! - 1) * filters.take! : undefined;

    const cohorts = await prisma.cohort.findMany({
      skip,
      take: shouldPaginate ? filters?.take : undefined,
      include: { program: true, courses: true },
    });
    return cohorts.map(addDeadlineFlag);
  }

  async getCohortById(id: number) {
    const cohort = await prisma.cohort.findUnique({
      where: { id },
      include: {
        program: true,
        courses: {
          select: {
            id: true,
            name: true,
            capacity: true,
            enrolled: true,
            schedule: true,
            classFormat: true,
            location: true,
            meetingLink: true,
            instructor: {
              select: {
                name: true,
                id: true,
              },
            },
          },
        },
      },
    });

    return cohort ? addDeadlineFlag(cohort) : null;
  }

  async updateCohort(id: number, data: any) {
    const cohort = await prisma.cohort.update({
      where: { id },
      data,
      include: { program: true, courses: true }, // Ensure relations are included
    });

    return addDeadlineFlag(cohort);
  }

  async deleteCohort(id: number) {
    const deletedCohort = await prisma.cohort.delete({
      where: { id },
    });

    return { message: "Cohort deleted successfully", deletedCohort };
  }
}

const addDeadlineFlag = (data: any | null) => {
  if (!data) return null; // Prevent errors if data is null
  const currentDate = new Date();
  const deadlineDate = new Date(data.applicationDeadline);

  return {
    ...data,
    isDeadlinePassed: currentDate > deadlineDate,
  };
};
