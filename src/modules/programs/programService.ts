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

    // Step 2: If there are prerequisites, add them separately
    if (data.prerequisites && data.prerequisites.length > 0) {
      await prisma.program_prerequisites.createMany({
        data: data.prerequisites.map((prerequisiteId: number) => ({
          programId: createdProgram.id,
          prerequisiteId,
        })),
      });
    }

    // Step 3: Fetch the program with prerequisites
    const updatedProgram = await prisma.program.findUnique({
      where: { id: createdProgram.id },
      include: {
        prerequisitePrograms: {
          select: { prerequisiteId: true,prerequisite: true },
      },
    },
    });

    console.log("Created program:", updatedProgram);
    return updatedProgram;
  }

  async getAllPrograms() {
    return await prisma.program.findMany({
      include: { topics: true, cohorts: true, prerequisitePrograms: {
        select: { prerequisiteId: true,prerequisite: true },
      } },
    });
  }

  async getProgramById(id: number) {
    return await prisma.program.findUnique({
      where: { id },
      include: { topics: true, cohorts: true, prerequisitePrograms: {
        select: { prerequisiteId: true,prerequisite: true },
    },
  }
  });
  }

  async updateProgram(id: number, data: any) {
    return await prisma.$transaction(async (prisma) => {
      // Step 1: Update the program details
      const updatedProgram = await prisma.program.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          eligibility: data.eligibility,
          topics: {
            deleteMany: {}, // Remove old topics
            create: data.topics.map((topic: string) => ({ name: topic })),
          },
        },
        include: { topics: true },
      });
  
      // Step 2: Update prerequisites (if provided)
      if (data.prerequisites) {
        // Delete old prerequisites
        await prisma.program_prerequisites.deleteMany({
          where: { programId: id },
        });
  
        // Add new prerequisites
        if (data.prerequisites.length > 0) {
          await prisma.program_prerequisites.createMany({
            data: data.prerequisites.map((prerequisiteId: number) => ({
              programId: id,
              prerequisiteId,
            })),
          });
        }
      }
  
      return await prisma.program.findUnique({
        where: { id },
        include: {
          topics: true,
          prerequisitePrograms: {
            include: { prerequisite: true }, // Fetch prerequisite details
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
}
