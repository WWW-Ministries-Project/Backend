import { prisma } from "../../Models/context";

export class ProgramService {
  async createProgram(data: any) {
    const createdProgram =  await prisma.program.create({
      data: {
        title: data.title,
        description: data.description,
        eligibility: data.eligibility,
        topics: {
          create: data.topics.map((topic: string) => ({ name: topic })),
        },
      },
      include: { topics: true },
    });
    console.log("created data"+createdProgram)
    return createdProgram;
  }

  async getAllPrograms() {
    console.log("Hereeee")
    return await prisma.program.findMany({
      include: { topics: true, cohorts: true },
    });
  }

  async getProgramById(id: number) {
    return await prisma.program.findUnique({
      where: { id },
      include: { topics: true, cohorts: true },
    });
  }

  async updateProgram(id: number, data: any) {
    return await prisma.program.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        eligibility: data.eligibility,
        topics: {
          deleteMany: {},
          create: data.topics.map((topic: string) => ({ name: topic })),
        },
      },
      include: { topics: true },
    });
  }

  async deleteProgram(id: number) {
    return await prisma.program.delete({
      where: { id },
    });
  }
}
