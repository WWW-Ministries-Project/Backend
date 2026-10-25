import { NextFunction, Request, Response } from "express";
import { getRequestAccess } from "../../middleWare/authorization";
import { courseFrom, somGuard } from "./somAccess";

const enrollOthers = somGuard("enroll_others", {
  programFallback: true,
  assigned: "target",
  target: courseFrom("body", "course_id"),
});

/**
 * Members enroll and unenroll themselves; acting on someone else's enrollment
 * needs School_of_ministry.enroll_others (instructors: in the programs they
 * teach). Run after `permissions.withAccess`.
 */
export const enrollGuard = (req: Request, res: Response, next: NextFunction) => {
  const me = getRequestAccess(req)?.userId;
  if (!me) return res.status(401).json({ message: "Not authorized", data: null });
  if (!req.body || typeof req.body !== "object") req.body = {};

  const target = Number(req.body.user_id);
  if (!Number.isInteger(target) || target <= 0) {
    req.body.user_id = me;
    return next();
  }
  if (target === me) return next();
  return enrollOthers(req, res, next);
};
