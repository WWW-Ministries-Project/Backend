import { prisma } from "../../Models/context";

export class ProgramService {
  async createProgram(data: any) {
    const existingPrerequisites = await prisma.program.findMany({
      where: {
        id: { in: data.prerequisites }, // Fetch all prerequisites that exist
      },
      select: { id: true }, 
    });
    
    // Extract the found IDs
    const foundIds = existingPrerequisites.map(p => p.id);
    
    // Find missing prerequisites
    if (data.prerequisites){
      const missingPrerequisites = data.prerequisites.filter((id: number) => !foundIds.includes(id));
    
      if (missingPrerequisites.length > 0) {
        throw new Error(`Missing prerequisites: ${missingPrerequisites.join(", ")}`);
      }
    }
    
    const createdProgram =  await prisma.program.create({
      data: {
        title: data.title,
        description: data.description,
        eligibility: data.eligibility,
        member_required: data.member_required,
        leader_required: data.leader_required,
        ministry_required: data.ministry_required,
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
          eligibility: data.eligibility,
          member_required: data.member_required,
          leader_required: data.leader_required,
          ministry_required: data.ministry_required,
        },
        include: { topics: true },
      });
  
      if (data.prerequisites) {
        await prisma.program_prerequisites.deleteMany({
          where: { programId: id },
        });
  
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

  //create topic programId, name
  async createTopic(programId:number, name:string) {
    // Step 1: Create the new topic
    const topic = await prisma.topic.create({
      data: { name, programId },
    });
  
    // Step 2: Find all enrolled students in this program
    const enrollments = await prisma.enrollment.findMany({
      where: {
        course: {
          cohort: {
            programId,
          },
        },
      },
      select: { id: true },
    });
  
    // Step 3: Create missing progress records
    if (enrollments.length > 0) {
      const progressEntries = enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        topicId: topic.id,
        score: 0
      }));
  
      await prisma.progress.createMany({ data: progressEntries });
    }
  
    return topic;
  };
  
  //update topic id, name
  async updateTopic(id:number, name:string){
    const updatedTopic = await prisma.topic.update({
      where:{id},data:{name}
    })
    return updatedTopic
  }
  //delete topic
  async deleteTopic(topicId: number) {
    await prisma.$transaction([
      prisma.progress.deleteMany({
        where: { topicId },
      }),
      prisma.topic.delete({
        where: { id: topicId }, // Then delete the topic
      }),
    ]);
  };

}
