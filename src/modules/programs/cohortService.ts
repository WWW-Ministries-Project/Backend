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

  async getAllCohorts() {
    const cohorts = await prisma.cohort.findMany({
      include: { program: true, courses: true },
    });
    return cohorts.map(addDeadlineFlag);
  }

  async getCohortById(id: number) {
    const cohort = await prisma.cohort.findUnique({
      where: { id },
      include: { program: true, courses: true },
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
