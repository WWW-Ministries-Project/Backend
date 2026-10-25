import { NextFunction, Request, Response } from "express";
import { prisma } from "../../Models/context";
import {
  getRequestAccess,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { domainScope, isLegacyRole } from "../../permissions/access";
import { getBranchScope } from "../branches/branchScope";
import { assertBranchAccessible } from "../branches/branchService";
import { assertProgramAbility, type InstructorAbility } from "./lms/lmsAccess";
import { LmsError } from "./lms/lmsHttp";

/**
 * School of Ministry route guards (run after `protect` and
 * `permissions.withAccess`). A caller gets in when:
 * - their role allows the catalogue action (src/permissions/catalog.ts); with
 *   the "Whole branch" scope they act on every program, with "Cohorts they
 *   instruct" only on programs they teach or are rostered on; or
 * - they instruct (teach a class or sit on a program's instructor roster) and
 *   the action is one instructors have always had, limited to their programs
 *   and to the abilities the program's roster gives them (can_grade, …) —
 *   unless their role switches that action off on purpose.
 * Programs reached by id must also be in one of the caller's branches.
 */

const DOMAIN = "School_of_ministry";

export type SomAction =
  | "view"
  | "view_reports"
  | "grade"
  | "take_attendance"
  | "manage_assignments"
  | "announce"
  | "design_curriculum"
  | "manage_cohorts"
  | "enroll_others"
  | "decide_applications"
  | "edit_progress"
  | "issue_certificates"
  | "manage_instructors";

/** What an instructor may do through teaching, and the roster flag it needs (null: any assignment). */
const INSTRUCTOR_ACTIONS: Partial<Record<SomAction, InstructorAbility | null>> = {
  view: null,
  grade: "can_grade",
  manage_assignments: "can_grade",
  edit_progress: "can_grade",
  take_attendance: "can_attendance",
  announce: "can_message",
  design_curriculum: "can_edit_curriculum",
  manage_cohorts: null,
  enroll_others: null,
};

export type SomScope = { manageAll: boolean; ability: InstructorAbility | null };

export type ProgramTarget = (req: Request) => Promise<number[]>;

interface GuardOptions {
  /** Resolves the program(s) a request acts on, for the branch and assignment checks. */
  target?: ProgramTarget;
  /**
   * How a caller limited to their own programs is handled: "target" checks
   * the resolved programs, "list" lets the controller narrow the list, and
   * false (default) keeps the route to whole-school roles.
   */
  assigned?: "target" | "list" | false;
  /** The route used to accept Program manage (the retired domain); kept for roles saved before actions. */
  programFallback?: boolean;
  /** Roles saved before actions keep the level that used to open this route. */
  legacyLevel?: "manage";
}

const actionSwitchedOff = (permissions: unknown, action: string) => {
  const actions = (permissions as any)?.Actions?.[DOMAIN];
  return Boolean(actions && typeof actions === "object" && actions[action] === false);
};

/**
 * The role's School of Ministry scope for an action. A View role starts at
 * "Cohorts they instruct"; a role saved before scopes existed has always seen
 * every program on the School of Ministry pages, so it keeps reading them
 * branch-wide (its View actions such as grading still reach only its cohorts).
 */
export const somScopeFor = (permissions: unknown, action: SomAction) => {
  const scope = domainScope(permissions, DOMAIN);
  const stored = (permissions as any)?.Scopes?.[DOMAIN];
  if (scope === "assigned" && action === "view" && !stored && isLegacyRole(permissions)) {
    return "branch";
  }
  return scope;
};

export const isSomInstructor = async (userId: number) => {
  const [taught, rostered] = await Promise.all([
    prisma.course.count({ where: { instructorId: userId } }),
    prisma.program_instructor.count({ where: { userId } }),
  ]);
  return taught > 0 || rostered > 0;
};

const roleAllows = async (userId: number, action: SomAction, branchId: number | null) =>
  action === "view"
    ? userHasBranchDomainPermission(userId, DOMAIN, "view", branchId)
    : userHasAction(userId, DOMAIN, action, branchId);

const assertProgramsInBranch = async (programIds: number[]) => {
  if (!programIds.length) return;
  const programs = await prisma.program.findMany({
    where: { id: { in: programIds } },
    select: { branch_id: true },
  });
  for (const program of programs) assertBranchAccessible(program.branch_id);
};

export const somGuard =
  (action: SomAction, options: GuardOptions = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    if (!access) return res.status(401).json({ message: "Not authorized", data: null });
    const me = access.userId;
    const branchId = getBranchScope()?.activeBranchId ?? null;
    const forbidden = (message = "You don't have permission to do this in School of Ministry") =>
      res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

    try {
      let allowed = false;
      let manageAll = false;

      if (access.isPrivilegedUser && (await roleAllows(me, action, branchId))) {
        allowed = true;
        manageAll = somScopeFor(access.permissions, action) === "branch";
      }

      const legacy = isLegacyRole(access.permissions);
      if (!manageAll && access.isPrivilegedUser && legacy) {
        const oldRule =
          (options.programFallback &&
            ((await userHasBranchDomainPermission(me, DOMAIN, "manage", branchId)) ||
              (await userHasBranchDomainPermission(me, "Program", "manage", branchId)))) ||
          (options.legacyLevel === "manage" &&
            (await userHasBranchDomainPermission(me, DOMAIN, "manage", branchId)));
        if (oldRule) {
          allowed = true;
          manageAll = true;
        }
      }

      const ability = INSTRUCTOR_ACTIONS[action];
      if (
        !allowed &&
        ability !== undefined &&
        options.assigned &&
        !actionSwitchedOff(access.permissions, action) &&
        (await isSomInstructor(me))
      ) {
        allowed = true;
      }

      if (!allowed) return forbidden();
      if (!manageAll && !options.assigned) {
        return forbidden("This needs School of Ministry access for the whole branch");
      }

      const scope: SomScope = { manageAll, ability: ability ?? null };
      (req as any).somScope = scope;

      const programIds = options.target ? await options.target(req) : [];
      await assertProgramsInBranch(programIds);
      if (!manageAll && options.assigned === "target") {
        if (!programIds.length) return forbidden("Choose one of the programs you teach");
        for (const programId of programIds) {
          await assertProgramAbility(req, programId, scope.ability);
        }
      }
      return next();
    } catch (error: any) {
      const status = error instanceof LmsError ? error.status : error?.statusCode;
      if (status && status < 500) {
        return res.status(status).json({ message: error.message, data: null });
      }
      return res.status(500).json({ message: "Something went wrong", error: error?.message });
    }
  };

/**
 * Deleting School of Ministry records needs Full on the module. The route
 * used to check Program Full (the retired domain), which still opens it.
 */
export const somDeleteGuard = (target?: ProgramTarget) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const access = getRequestAccess(req);
    if (!access) return res.status(401).json({ message: "Not authorized", data: null });
    const branchId = getBranchScope()?.activeBranchId ?? null;
    try {
      const allowed =
        access.isPrivilegedUser &&
        // The catalogue has no School_of_ministry.delete action yet (requested);
        // until it does, Full on the module is the delete right.
        ((await userHasBranchDomainPermission(access.userId, DOMAIN, "admin", branchId)) ||
          (await userHasBranchDomainPermission(access.userId, "Program", "admin", branchId)));
      if (!allowed) {
        return res.status(403).json({
          message: "Not authorized to delete school of ministry data",
          data: null,
          code: "ACTION_FORBIDDEN",
        });
      }
      (req as any).somScope = { manageAll: true, ability: null } satisfies SomScope;
      if (target) await assertProgramsInBranch(await target(req));
      return next();
    } catch (error: any) {
      const status = error instanceof LmsError ? error.status : error?.statusCode;
      if (status && status < 500) {
        return res.status(status).json({ message: error.message, data: null });
      }
      return res.status(500).json({ message: "Something went wrong", error: error?.message });
    }
  };

/**
 * Programs a caller limited to their own may work in, or undefined when the
 * route's guard gave them the whole school. A roster entry decides the
 * abilities; teaching a class without one gives everything but curriculum
 * editing (as in lms/lmsAccess.ts).
 */
export const somProgramIds = async (req: Request): Promise<number[] | undefined> => {
  const scope = (req as any).somScope as SomScope | undefined;
  if (!scope || scope.manageAll) return undefined;
  const userId = getRequestAccess(req)?.userId;
  if (!userId) return [];
  const [rosters, taught] = await Promise.all([
    prisma.program_instructor.findMany({ where: { userId } }),
    prisma.course.findMany({
      where: { instructorId: userId },
      select: { cohort: { select: { programId: true } } },
    }),
  ]);
  const ability = scope.ability;
  const rostered = new Set(rosters.map((r) => r.programId));
  const ids = new Set(rosters.filter((r) => !ability || r[ability]).map((r) => r.programId));
  if (ability !== "can_edit_curriculum") {
    for (const course of taught) {
      if (!rostered.has(course.cohort.programId)) ids.add(course.cohort.programId);
    }
  }
  return Array.from(ids);
};

// Target resolvers ----------------------------------------------------------

type Source = "body" | "query" | "params";

const readIds = (req: Request, source: Source, key: string): number[] => {
  const raw = (req as any)[source]?.[key];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const unique = (ids: Array<number | null | undefined>) =>
  Array.from(new Set(ids.filter((id): id is number => Boolean(id))));

export const programFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) =>
    readIds(req, source, key);

export const cohortFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.cohort.findMany({ where: { id: { in: ids } }, select: { programId: true } });
    return unique(rows.map((r) => r.programId));
  };

export const courseFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.course.findMany({
      where: { id: { in: ids } },
      select: { cohort: { select: { programId: true } } },
    });
    return unique(rows.map((r) => r.cohort.programId));
  };

export const topicFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.topic.findMany({ where: { id: { in: ids } }, select: { programId: true } });
    return unique(rows.map((r) => r.programId));
  };

export const moduleFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.program_module.findMany({
      where: { id: { in: ids } },
      select: { programId: true },
    });
    return unique(rows.map((r) => r.programId));
  };

export const enrollmentFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.enrollment.findMany({
      where: { id: { in: ids } },
      select: { course: { select: { cohort: { select: { programId: true } } } } },
    });
    return unique(rows.map((r) => r.course.cohort.programId));
  };

export const submissionFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.assignment_submission.findMany({
      where: { id: { in: ids } },
      select: { learningUnit: { select: { topic: { select: { programId: true } } } } },
    });
    return unique(rows.map((r) => r.learningUnit.topic.programId));
  };

export const rosterFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.program_instructor.findMany({
      where: { id: { in: ids } },
      select: { programId: true },
    });
    return unique(rows.map((r) => r.programId));
  };

export const sessionFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.lms_session.findMany({
      where: { id: { in: ids } },
      select: { cohort: { select: { programId: true } } },
    });
    return unique(rows.map((r) => r.cohort.programId));
  };

export const extensionFrom =
  (source: Source, key: string): ProgramTarget =>
  async (req) => {
    const ids = readIds(req, source, key);
    if (!ids.length) return [];
    const rows = await prisma.assignment_extension.findMany({
      where: { id: { in: ids } },
      select: { cohort: { select: { programId: true } } },
    });
    return unique(rows.map((r) => r.cohort.programId));
  };

/** Progress rows named in `progressId` or `progressUpdates[].enrollmentId`. */
export const progressFrom: ProgramTarget = async (req) => {
  const progressIds = readIds(req, "body", "progressId");
  const updates = Array.isArray(req.body?.progressUpdates) ? req.body.progressUpdates : [];
  const enrollmentIds = unique(updates.map((u: any) => Number(u?.enrollmentId)).filter(Number.isInteger));
  if (!progressIds.length && !enrollmentIds.length) return [];
  const rows = await prisma.enrollment.findMany({
    where: {
      OR: [
        ...(progressIds.length ? [{ progress: { some: { id: { in: progressIds } } } }] : []),
        ...(enrollmentIds.length ? [{ id: { in: enrollmentIds } }] : []),
      ],
    },
    select: { course: { select: { cohort: { select: { programId: true } } } } },
  });
  return unique(rows.map((r) => r.course.cohort.programId));
};

/** Every program any of the resolvers reaches. */
export const anyOf =
  (...targets: ProgramTarget[]): ProgramTarget =>
  async (req) =>
    unique((await Promise.all(targets.map((t) => t(req)))).flat());

/**
 * Cohort announcements go out through Messaging, so email and SMS also need
 * Messaging.send_email / Messaging.send_sms (SMS costs money). In-app needs
 * only `announce`. Roles saved before actions (and instructors without a
 * role) keep today's rule: `announce` alone.
 */
export const assertMessagingChannels = async (
  req: Request,
  channels: { email: boolean; sms: boolean },
) => {
  const access = getRequestAccess(req);
  if (!access || isLegacyRole(access.permissions)) return;
  const branchId = getBranchScope()?.activeBranchId ?? null;
  if (channels.sms && !(await userHasAction(access.userId, "Messaging", "send_sms", branchId))) {
    throw new LmsError("Sending SMS needs Messaging › Send SMS on your role", 403);
  }
  if (channels.email && !(await userHasAction(access.userId, "Messaging", "send_email", branchId))) {
    throw new LmsError("Sending email needs Messaging › Send email on your role", 403);
  }
};
