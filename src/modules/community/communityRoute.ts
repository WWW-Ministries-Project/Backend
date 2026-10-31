import Router from "express";
import * as controller from "./communityController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();
const protect = permissions.protect;

export const communityRouter = Router();

// Every Community endpoint needs a signed-in member. The probe never rejects:
// it records the caller's Community view/manage access for the services, which
// also turn guests and deactivated accounts away (403). `withAccess` sets
// `req.access`, from which the controller resolves Community actions and scope.
const member = [protect, permissions.attach_community_management, permissions.withAccess];
const moderator = [...member, permissions.can_view_community];
const action = (key: string, message: string) => [
  ...member,
  permissions.requireAction("Community", key, message),
];
const moderate = action("moderate", "Not authorized to moderate the community");

// Static paths are registered before the `/:id` ones that would capture them.
communityRouter.get("/me", member, controller.getMe);
communityRouter.get("/feed", member, controller.getFeed);
communityRouter.get("/departments", member, controller.getDepartments);
communityRouter.get("/members", member, controller.searchMembers);

communityRouter.post("/posts", member, controller.createPost);
communityRouter.get("/posts/:id", member, controller.getPost);
communityRouter.put("/posts/:id", member, controller.updatePost);
communityRouter.delete("/posts/:id", member, controller.deletePost);
communityRouter.post("/posts/:id/reactions", member, controller.togglePostReaction);
communityRouter.get("/posts/:id/reactions", member, controller.getPostReactions);
communityRouter.post("/posts/:id/comments", member, controller.createComment);
communityRouter.post("/posts/:id/hide", member, controller.hidePost);
communityRouter.delete("/posts/:id/hide", member, controller.unhidePost);

communityRouter.delete("/comments/:id", member, controller.deleteComment);
communityRouter.post("/comments/:id/reactions", member, controller.toggleCommentReaction);
communityRouter.get("/comments/:id/reactions", member, controller.getCommentReactions);
communityRouter.post("/comments/:id/hide", member, controller.hideComment);
communityRouter.delete("/comments/:id/hide", member, controller.unhideComment);

communityRouter.post("/reports", member, controller.createReport);
communityRouter.post("/blocks", member, controller.createBlock);
communityRouter.get("/blocks", member, controller.getBlocks);
communityRouter.delete("/blocks/:blockId", member, controller.deleteBlock);

communityRouter.get("/notifications", member, controller.getNotifications);
communityRouter.post("/notifications/read-all", member, controller.readAllNotifications);
communityRouter.patch("/notifications/:id/read", member, controller.readNotification);

// Moderation and admin.
communityRouter.get("/moderation/reports", moderator, controller.getReports);
// Community.view_audit_log (Manage still counts for roles saved before
// actions); checked in the service.
communityRouter.get("/moderation/audit-log", member, controller.getAuditLog);
communityRouter.post("/moderation/:kind/:id/remove", moderate, controller.removeContent);
communityRouter.post("/moderation/:kind/:id/restore", moderate, controller.restoreContent);
communityRouter.post("/moderation/:kind/:id/warn", moderate, controller.warnAuthor);
communityRouter.get("/admin/posts", moderator, controller.getAdminPosts);
communityRouter.get("/admin/stats", moderator, controller.getAdminStats);
communityRouter.post(
  "/admin/posts/:id/pin",
  action("pin_important", "Not authorized to pin community posts"),
  controller.pinPost,
);

export default communityRouter;
