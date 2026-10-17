import { Request } from "express";
import { prisma } from "../../../Models/context";
import { LmsError, requestUserId } from "./lmsHttp";

export type InstructorAbility = "can_grade" | "can_attendance" | "can_message";

/**
 * School-of-ministry managers may act on any cohort. Facilitators (instructors)
 * pass the route guard too, so here they are limited to programs where they are
 * on the instructor roster with the ability, or — when the program has no
 * roster entry for them — programs where they teach a class (default: may
 * grade, take attendance and message).
 */
export const assertProgramAbility = async (req: Request, programId: number, ability: InstructorAbility) => {
  const scope = (req as Request & { somScope?: { manageAll: boolean } }).somScope;
  if (!scope || scope.manageAll) return;

  const userId = requestUserId(req);
  if (!userId) throw new LmsError("Not authorized for this program", 403);

  const roster = await prisma.program_instructor.findUnique({
    where: { programId_userId: { programId, userId } },
  });
  if (roster) {
    if (roster[ability]) return;
    throw new LmsError("You do not have permission to do this in this program", 403);
  }

  const teaches = await prisma.course.count({ where: { instructorId: userId, cohort: { programId } } });
  if (teaches > 0) return;
  throw new LmsError("You do not teach in this program", 403);
};

export const programIdForCohort = async (cohortId: number) => {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { programId: true } });
  if (!cohort) throw new LmsError("Cohort not found", 404);
  return cohort.programId;
};

export const programIdForTopic = async (topicId: number) => {
  const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: { programId: true } });
  if (!topic) throw new LmsError("Topic not found", 404);
  return topic.programId;
};

export const assertCohortAbility = async (req: Request, cohortId: number, ability: InstructorAbility) =>
  assertProgramAbility(req, await programIdForCohort(cohortId), ability);

export const programIdForSubmission = async (submissionId: number) => {
  const sub = await prisma.assignment_submission.findUnique({
    where: { id: submissionId },
    select: { learningUnit: { select: { topic: { select: { programId: true } } } } },
  });
  if (!sub) throw new LmsError("Submission not found", 404);
  return sub.learningUnit.topic.programId;
};

export const programIdForExtension = async (extensionId: number) => {
  const ext = await prisma.assignment_extension.findUnique({
    where: { id: extensionId },
    select: { cohort: { select: { programId: true } } },
  });
  if (!ext) throw new LmsError("Extension not found", 404);
  return ext.cohort.programId;
};

/** Cohorts a facilitator may see; undefined for School-of-Ministry managers (no restriction). */
export const facilitatorCohortIds = async (req: Request): Promise<number[] | undefined> => {
  const scope = (req as Request & { somScope?: { manageAll: boolean } }).somScope;
  if (!scope || scope.manageAll) return undefined;
  const userId = requestUserId(req);
  if (!userId) return [];
  const [taught, rostered] = await Promise.all([
    prisma.course.findMany({ where: { instructorId: userId }, select: { cohortId: true } }),
    prisma.program_instructor.findMany({
      where: { userId, can_attendance: true },
      select: { program: { select: { cohorts: { select: { id: true } } } } },
    }),
  ]);
  return Array.from(
    new Set([...taught.map((c) => c.cohortId), ...rostered.flatMap((r) => r.program.cohorts.map((c) => c.id))]),
  );
};
