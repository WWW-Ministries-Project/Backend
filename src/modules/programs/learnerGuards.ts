import { NextFunction, Request, Response } from "express";
import {
  getRequestAccess,
  isInstructor,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { getBranchScope } from "../branches/branchScope";

/**
 * Learner endpoints used to trust a `userId` from the request, so anyone
 * signed in could act as, or read, another learner; and they returned the
 * multiple-choice answer keys. Run after `permissions.withAccess`.
 */

/** School of Ministry managers and instructors work with other people's learning. */
const canWorkWithLearners = async (userId: number) => {
  const branchId = getBranchScope()?.activeBranchId ?? null;
  const [som, program] = await Promise.all([
    userHasBranchDomainPermission(userId, "School_of_ministry", "manage", branchId),
    userHasBranchDomainPermission(userId, "Program", "manage", branchId),
  ]);
  return som || program || (await isInstructor(userId));
};

type Source = "body" | "query" | "params";

/**
 * Binds the learner id fields to the caller: a missing id becomes theirs, and
 * someone else's id is refused unless the caller manages School of Ministry
 * or instructs.
 */
export const bindLearnerToCaller =
  (fields: Array<[Source, string]>, { fillMissing = true } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const me = getRequestAccess(req)?.userId;
    if (!me) return res.status(401).json({ message: "Not authorized", data: null });

    let other = false;
    for (const [source, key] of fields) {
      const bag = (req as any)[source] || {};
      const raw = bag[key];
      if (raw !== undefined && raw !== null && raw !== "" && Number(raw) !== me) other = true;
    }
    if (other && !(await canWorkWithLearners(me))) {
      return res.status(403).json({
        message: "You can only see and submit your own learning.",
        data: null,
      });
    }
    if (!other && fillMissing) {
      for (const [source, key] of fields) {
        const bag = (req as any)[source];
        if (bag && source !== "params") bag[key] = source === "query" ? String(me) : me;
      }
    }
    return next();
  };

const stripAnswerKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripAnswerKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "correctOptionId" || key === "correct_option_id") continue;
      // Learning-unit data is sometimes stored as a JSON string.
      if (typeof inner === "string" && inner.includes("correctOptionId")) {
        try {
          out[key] = JSON.stringify(stripAnswerKeys(JSON.parse(inner)));
          continue;
        } catch {
          // not JSON; keep as is
        }
      }
      out[key] = stripAnswerKeys(inner);
    }
    return out;
  }
  return value;
};

/** Removes multiple-choice answer keys from the response for anyone who isn't a manager or instructor. */
export const hideAnswerKeysFromLearners = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const me = getRequestAccess(req)?.userId;
  if (me && (await canWorkWithLearners(me))) return next();
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(stripAnswerKeys(body))) as Response["json"];
  return next();
};
