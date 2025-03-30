import { progress_status } from "@prisma/client";
import { prisma } from "../../Models/context";


export class EnrollmentService {
      async enrollUser(payload: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        courseId: number;
        isMember: boolean;
        userId?: number;
      }) {
        const { firstName, lastName, email, phone, courseId, userId } = payload;

        const course = await prisma.course.findUnique({
          where: { id: courseId },
          select: { enrolled: true, capacity: true, cohortId: true }, // Get cohortId
        });
        
        if (!course) {
          throw new Error("Course not found.");
        }
        
        if (course.enrolled >= course.capacity) {
          throw new Error("Course is full.");
        }
        
        // Check for duplicate enrollment
        const existingEnrollment = await prisma.enrollment.findFirst({
          where: userId
            ? { userId, courseId } // Check by userId for registered users
            : { email, courseId }, // Check by email for non-users
        });
        
        if (existingEnrollment) {
          throw new Error("User is already enrolled in this course.");
        }
        
        // Enroll user & update enrolled count in a transaction
        const [enrollment] = await prisma.$transaction([
          prisma.enrollment.create({
            data: {
              userId,
              courseId,
              firstName,
              lastName,
              email,
              phone,
            },
          }),
          prisma.course.update({
            where: { id: courseId },
            data: { enrolled: { increment: 1 } },
          }),
        ]);
        
        // Step 3: Auto-Generate Progress for Each Topic
        const topics = await prisma.topic.findMany({
          where: {
            program: {
              cohorts: {
                some: { id: course.cohortId },
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
              score: 0, // Default score
              status: "PENDING",
            })),
          });
        }
        
        return enrollment;
        
    }

  
    async getEnrollmentsByCourse(courseId: number) {
      return await prisma.enrollment.findMany({
        where: { courseId },
        include: { user: true },
      });
    }
  
    async getUserEnrollments(userId: number) {
      return await prisma.enrollment.findMany({
        where: { userId },
        include: { course: true },
      });
    }
  
    async unenrollUser(courseId: number, userId: number) {
      // Remove enrollment
      const enrollment = await prisma.enrollment.delete({
        where: { userId_courseId: { userId, courseId } },
      });
  
      // Update enrolled count
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (course) {
        await prisma.course.update({
          where: { id: courseId },
          data: { enrolled: course.enrolled - 1 },
        });
      }
  
      return enrollment;
    }

    async getProgressDetails(enrollmentId: number){
      const enrollmentData = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
          course: {
            include: {
              cohort: {
                include: {
                  program: {
                    include: {
                      topics: true, // Do NOT include progress here
                    },
                  },
                },
              },
            },
          },
        },
      });
      
      // Fetch progress separately and map it to topics
      const progressData = await prisma.progress.findMany({
        where: { enrollmentId },
        select: {
          id:true,
          topicId: true,
          score: true,
          status: true,
          completedAt: true,
        },
      });
      
      // Map progress data to topics
      if (enrollmentData?.course?.cohort?.program?.topics) {
        const progressMap = Object.fromEntries(
          progressData.map((p) => [p.topicId, p])
        );
      
        enrollmentData.course.cohort.program.topics = enrollmentData.course.cohort.program.topics.map(
          (topic) => ({
            ...topic,
            score: progressMap[topic.id]?.score ?? null,
            progressId: progressMap[topic.id]?.id,
            status: progressMap[topic.id]?.status ?? "PENDING",
            completedAt: progressMap[topic.id]?.completedAt ?? null,
          })
        );
      }
      
      return enrollmentData;
    
  }
  async updateProgressScores(progressId: number,score: number, status: progress_status) {
    
    const updatedProgress = await prisma.progress.update({
      where: {
        id: progressId
      },
      data: {
        score,
        status
      }
    });
  
    return updatedProgress;
  }
}
