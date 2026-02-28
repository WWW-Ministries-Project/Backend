import { Request, Response, Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { AiController } from "./aiController";

const aiRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;
const aiController = new AiController();

aiRouter.get(
  "/credentials",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.listCredentials(req, res),
);

aiRouter.post(
  "/credentials",
  [protect, permissions.can_manage_ai],
  (req: Request, res: Response) => aiController.createCredential(req, res),
);

aiRouter.put(
  "/credentials/:id",
  [protect, permissions.can_manage_ai],
  (req: Request, res: Response) => aiController.updateCredential(req, res),
);

aiRouter.post(
  "/chat",
  [protect, permissions.can_manage_ai],
  (req: Request, res: Response) => aiController.chat(req, res),
);

aiRouter.get(
  "/usage-summary",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.usageSummary(req, res),
);

aiRouter.get(
  "/usage/summary",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.usageSummary(req, res),
);

aiRouter.get(
  "/usage-history",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.usageHistory(req, res),
);

aiRouter.get(
  "/usage/history",
  [protect, permissions.can_view_ai],
  (req: Request, res: Response) => aiController.usageHistory(req, res),
);

aiRouter.post(
  "/insights/:module",
  [protect, permissions.can_manage_ai],
  (req: Request, res: Response) => aiController.insights(req, res),
);

export default aiRouter;
