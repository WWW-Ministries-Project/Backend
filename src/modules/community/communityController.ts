import { Request, Response } from "express";
import { UnauthorizedError } from "../../utils/custom-error-handlers";
import * as community from "./communityService";
import * as moderation from "./communityModerationService";
import { toPositiveInt } from "./communityHelpers";
import { Viewer, loadViewer } from "./communityQueries";

/**
 * Thin HTTP layer over the Community services. Business-rule failures are
 * thrown as AppErrors and shaped by the global error handler
 * (express-async-errors forwards the async throws).
 */
const viewerOf = async (req: Request): Promise<Viewer> => {
  const id = toPositiveInt((req as any)?.user?.id);
  if (!id) throw new UnauthorizedError("Not authorized");
  return loadViewer(id, {
    canView: Boolean((req as any).canViewCommunity),
    canManage: Boolean((req as any).canManageCommunity),
  });
};

const ok = (res: Response, data: unknown, message = "Success", status = 200) =>
  res.status(status).json({ message, data });

const list = (
  res: Response,
  result: { data: unknown; total: number } & Record<string, unknown>,
  message = "Success",
) => res.status(200).json({ message, ...result });

/* Member-facing */

export const getMe = async (req: Request, res: Response) =>
  ok(res, await community.getMe(await viewerOf(req)));

export const getFeed = async (req: Request, res: Response) =>
  list(res, await community.listFeed(await viewerOf(req), req.query));

export const getDepartments = async (req: Request, res: Response) =>
  ok(res, await community.listDepartments(await viewerOf(req)));

export const getPost = async (req: Request, res: Response) =>
  ok(res, await community.getPost(await viewerOf(req), req.params.id));

export const createPost = async (req: Request, res: Response) =>
  ok(res, await community.createPost(await viewerOf(req), req.body ?? {}), "Post shared", 201);

export const updatePost = async (req: Request, res: Response) =>
  ok(res, await community.updatePost(await viewerOf(req), req.params.id, req.body ?? {}), "Post updated");

export const deletePost = async (req: Request, res: Response) =>
  ok(res, await community.deletePost(await viewerOf(req), req.params.id), "Post deleted");

export const togglePostReaction = async (req: Request, res: Response) =>
  ok(res, await community.togglePostReaction(await viewerOf(req), req.params.id, req.body ?? {}));

export const getPostReactions = async (req: Request, res: Response) =>
  ok(res, await community.listPostReactions(await viewerOf(req), req.params.id));

export const createComment = async (req: Request, res: Response) =>
  ok(res, await community.createComment(await viewerOf(req), req.params.id, req.body ?? {}), "Comment added", 201);

export const deleteComment = async (req: Request, res: Response) =>
  ok(res, await community.deleteComment(await viewerOf(req), req.params.id), "Comment deleted");

export const toggleCommentReaction = async (req: Request, res: Response) =>
  ok(res, await community.toggleCommentReaction(await viewerOf(req), req.params.id, req.body ?? {}));

export const getCommentReactions = async (req: Request, res: Response) =>
  ok(res, await community.listCommentReactions(await viewerOf(req), req.params.id));

export const hidePost = async (req: Request, res: Response) =>
  ok(res, await community.hidePost(await viewerOf(req), req.params.id), "Post hidden");

export const unhidePost = async (req: Request, res: Response) =>
  ok(res, await community.unhidePost(await viewerOf(req), req.params.id), "Post shown again");

export const hideComment = async (req: Request, res: Response) =>
  ok(res, await community.hideComment(await viewerOf(req), req.params.id), "Comment hidden");

export const unhideComment = async (req: Request, res: Response) =>
  ok(res, await community.unhideComment(await viewerOf(req), req.params.id), "Comment shown again");

export const createReport = async (req: Request, res: Response) =>
  ok(res, await community.createReport(await viewerOf(req), req.body ?? {}), "Report sent to the moderators", 201);

export const createBlock = async (req: Request, res: Response) =>
  ok(res, await community.createBlock(await viewerOf(req), req.body ?? {}), "Member blocked", 201);

export const getBlocks = async (req: Request, res: Response) =>
  ok(res, await community.listBlocks(await viewerOf(req)));

export const deleteBlock = async (req: Request, res: Response) =>
  ok(res, await community.deleteBlock(await viewerOf(req), req.params.blockId), "Member unblocked");

export const searchMembers = async (req: Request, res: Response) =>
  ok(res, await community.searchMembers(await viewerOf(req), req.query));

export const getNotifications = async (req: Request, res: Response) =>
  list(res, await community.listNotifications(await viewerOf(req), req.query));

export const readAllNotifications = async (req: Request, res: Response) =>
  ok(res, await community.markAllNotificationsRead(await viewerOf(req)));

export const readNotification = async (req: Request, res: Response) =>
  ok(res, await community.markNotificationRead(await viewerOf(req), req.params.id));

/* Moderation / admin (Community permission, checked by the route guards) */

export const getReports = async (req: Request, res: Response) =>
  list(res, await moderation.listReports(await viewerOf(req), req.query));

export const removeContent = async (req: Request, res: Response) =>
  ok(res, await moderation.moderate(await viewerOf(req), req.params.kind, req.params.id, "remove"), "Content removed");

export const restoreContent = async (req: Request, res: Response) =>
  ok(res, await moderation.moderate(await viewerOf(req), req.params.kind, req.params.id, "restore"), "Content restored");

export const warnAuthor = async (req: Request, res: Response) =>
  ok(res, await moderation.moderate(await viewerOf(req), req.params.kind, req.params.id, "warn"), "Author warned");

export const getAdminPosts = async (req: Request, res: Response) =>
  list(res, await moderation.listAdminPosts(await viewerOf(req), req.query));

export const getAuditLog = async (req: Request, res: Response) => {
  await viewerOf(req);
  return list(res, await moderation.listAuditLog(req.query));
};
