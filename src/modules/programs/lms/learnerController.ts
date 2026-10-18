import { Request } from "express";
import { learnerService } from "./learnerService";
import { LmsError, lmsHandler, optionalDate, positiveInt, requestUserId } from "./lmsHttp";

const me = (req: Request) => {
  const userId = requestUserId(req);
  if (!userId) throw new LmsError("Not signed in", 401);
  return userId;
};

/** Member-facing learner portal. Every action reads the signed-in user's own data only. */
export const learnerController = {
  overview: lmsHandler("Learner overview fetched", (req) => learnerService.overview(me(req))),
  sessions: lmsHandler("Learner sessions fetched", (req) =>
    learnerService.sessions(me(req), optionalDate(req.query.from, "from")),
  ),
  announcements: lmsHandler("Learner announcements fetched", (req) => learnerService.announcements(me(req))),
  submission: lmsHandler("Learner submission fetched", (req) =>
    learnerService.submission(me(req), positiveInt(req.query.topicId, "topicId")),
  ),
};
