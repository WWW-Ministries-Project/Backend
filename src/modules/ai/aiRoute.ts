import { NextFunction, Request, Response, Router } from "express";
import {
  getRequestAccess,
  hasActionPermission,
  Permissions,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { isLegacyRole } from "../../permissions/access";
import { getBranchScope } from "../branches/branchScope";
import { AiController } from "./aiController";

const aiRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;
const aiController = new AiController();

/**
 * Chat and insights spend AI credit. Roles saved before actions existed only
 * had them with AI manage (AI falls back to Settings, so their View would
 * otherwise open it to every Settings viewer); they keep needing manage.
 */
const legacyNeedsAiManage = (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  if (
    access &&
    isLegacyRole(access.permissions) &&
    !hasActionPermission(access.permissions, "AI", "manage")
  ) {
    return res.status(403).json({ message: "Not authorized to use the AI assistant", data: null });
  }
  return next();
};
const chatAction = permissions.requireAction("AI", "chat", "Not authorized to use the AI assistant");
const chat = [chatAction, legacyNeedsAiManage];
const generateInsightsAction = permissions.requireAction(
  "AI",
  "generate_insights",
  "Not authorized to generate AI insights",
);
const generateInsights = [generateInsightsAction, legacyNeedsAiManage];
const queryData = permissions.requireAction("AI", "query_data", "Not authorized to query data with AI");
const viewTasks = permissions.requireAction(
  "AI",
  "view_tasks",
  "Not authorized to view assistant tasks",
);
const viewUsage = permissions.requireAction("AI", "view_usage", "Not authorized to view AI usage");

/**
 * AI.manage_credentials is on purpose (Full), so a new role only has it when
 * switched on. Roles saved before actions existed keep the old rule: AI manage.
 */
const canManageCredentials = async (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  if (!access) {
    return res.status(401).json({ message: "Not authorized", data: null });
  }
  const branchId = getBranchScope()?.activeBranchId ?? null;
  const allowed =
    (await userHasAction(access.userId, "AI", "manage_credentials", branchId)) ||
    (isLegacyRole(access.permissions) &&
      (await userHasBranchDomainPermission(access.userId, "AI", "manage", branchId)));
  if (allowed) return next();
  return res.status(403).json({
    message: "Not authorized to manage AI credentials",
    data: null,
    code: "ACTION_FORBIDDEN",
  });
};

aiRouter.get(
  "/credentials",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.listCredentials(req, res),
);

aiRouter.post(
  "/credentials",
  [protect, permissions.withAccess, canManageCredentials],
  (req: Request, res: Response) => aiController.createCredential(req, res),
);

aiRouter.put(
  "/credentials/:id",
  [protect, permissions.withAccess, canManageCredentials],
  (req: Request, res: Response) => aiController.updateCredential(req, res),
);

aiRouter.get(
  "/settings",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.getSettings(req, res),
);

aiRouter.put(
  "/settings",
  [protect, permissions.withAccess, canManageCredentials],
  (req: Request, res: Response) => aiController.updateSettings(req, res),
);

aiRouter.get(
  "/chatbot/config",
  [protect, ...chat],
  (req: Request, res: Response) => aiController.chatbotConfig(req, res),
);

aiRouter.post(
  "/chatbot",
  [protect, ...chat],
  (req: Request, res: Response) => aiController.chatbot(req, res),
);

aiRouter.post(
  "/chat",
  [protect, ...chat],
  (req: Request, res: Response) => aiController.chat(req, res),
);

aiRouter.get(
  "/usage-summary",
  [protect, viewUsage],
  (req: Request, res: Response) => aiController.usageSummary(req, res),
);

aiRouter.get(
  "/usage/summary",
  [protect, viewUsage],
  (req: Request, res: Response) => aiController.usageSummary(req, res),
);

aiRouter.get(
  "/usage-history",
  [protect, viewUsage],
  (req: Request, res: Response) => aiController.usageHistory(req, res),
);

aiRouter.get(
  "/usage/history",
  [protect, viewUsage],
  (req: Request, res: Response) => aiController.usageHistory(req, res),
);

aiRouter.get(
  "/tasks",
  [protect, viewTasks],
  (req: Request, res: Response) => aiController.tasks(req, res),
);

aiRouter.post(
  "/tasks/state",
  [protect, viewTasks],
  (req: Request, res: Response) => aiController.setTaskState(req, res),
);

aiRouter.delete(
  "/tasks/state/:taskKey",
  [protect, viewTasks],
  (req: Request, res: Response) => aiController.clearTaskState(req, res),
);

aiRouter.get(
  "/preferences",
  [protect],
  (req: Request, res: Response) => aiController.getPreferences(req, res),
);

aiRouter.patch(
  "/preferences",
  [protect],
  (req: Request, res: Response) => aiController.updatePreferences(req, res),
);

aiRouter.get(
  "/query-contracts",
  [protect, queryData],
  (req: Request, res: Response) => aiController.queryContracts(req, res),
);

aiRouter.post(
  "/query-read-only",
  [protect, queryData],
  (req: Request, res: Response) => aiController.queryReadOnly(req, res),
);

aiRouter.post(
  "/insights/:module",
  [protect, ...generateInsights],
  (req: Request, res: Response) => aiController.insights(req, res),
);

export default aiRouter;
