import { prisma } from "../../Models/context";

export class ProgramService {
  async createProgram(data: any) {
    //check if the prerequisit program is there
    const existingPrerequisites = await prisma.program.findMany({
      where: {
        id: { in: data.prerequisites }, // Fetch all prerequisites that exist
      },
      select: { id: true }, 
    });
    
    // Extract the found IDs
    const foundIds = existingPrerequisites.map(p => p.id);
    
    // Find missing prerequisites
    const missingPrerequisites = data.prerequisites.filter((id: number) => !foundIds.includes(id));
    
    if (missingPrerequisites.length > 0) {
      throw new Error(`Missing prerequisites: ${missingPrerequisites.join(", ")}`);
    }
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
