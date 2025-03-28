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
    select: { enrolled: true, capacity: true },
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

  // Enroll the user/non-user and update enrolled count in a transaction
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
  }
