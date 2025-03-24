import { prisma } from "../../Models/context";

export class CohortService {
    async createCohort(programId: number, data: any) {
      return await prisma.cohort.create({
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
    }
  
    async getAllCohortsByProgramID(programId: number) {
      return await prisma.cohort.findMany({
        where: { programId },
        include: { program: true },
      });
    }
    async getAllCohorts() {
        return await prisma.cohort.findMany({
          include: { program: true },
        });
      }
  
    async getCohortById(id: number) {
      return await prisma.cohort.findUnique({
        where: { id },
        include: { program: true, courses: true },
      });
    }
  
    async updateCohort(id: number, data: any) {
      return await prisma.cohort.update({
        where: { id },
        data,
      });
    }
  
    async deleteCohort(id: number) {
      return await prisma.cohort.delete({
        where: { id },
      });
    }
  }