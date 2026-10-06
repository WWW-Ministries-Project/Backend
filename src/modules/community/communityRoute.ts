import Router from "express";
import * as controller from "./communityController";
import { Permissions } from "../../middleWare/authorization";

const permissions = new Permissions();
const protect = permissions.protect;

export const communityRouter = Router();

// Every Community endpoint needs a signed-in member. The probe never rejects:
// it records the caller's Community view/manage access for the services, which
// also turn guests and deactivated accounts away (403).
const member = [protect, permissions.attach_community_management];
const moderator = [...member, permissions.can_view_community];
const manager = [...member, permissions.can_manage_community];

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
communityRouter.get("/moderation/audit-log", manager, controller.getAuditLog);
communityRouter.post("/moderation/:kind/:id/remove", manager, controller.removeContent);
communityRouter.post("/moderation/:kind/:id/restore", manager, controller.restoreContent);
communityRouter.post("/moderation/:kind/:id/warn", manager, controller.warnAuthor);
communityRouter.get("/admin/posts", moderator, controller.getAdminPosts);

export default communityRouter;
