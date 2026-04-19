import { NextFunction, Request, Response, Router } from "express";
import { FinancialsController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { prisma } from "../../../Models/context";
import { userHasMinimumDomainAccess } from "../../../utils/permissionResolver";

const financialsRouter = Router();
const controller = new FinancialsController();
const permissions = new Permissions();
const protect = permissions.protect;

const canManageFinancialsOrActAsApprover = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = (req as any).user;
    const actorUserId = Number(currentUser?.id);
    const tokenPermissions = currentUser?.permissions;

    if (
      userHasMinimumDomainAccess(tokenPermissions, "Financials", "manage")
    ) {
      return next();
    }

    if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const config = await prisma.finance_approval_config.findUnique({
      where: {
        config_key: "FINANCE",
      },
      select: {
        finance_approver_user_id: true,
      },
    });

    if (config?.finance_approver_user_id === actorUserId) {
      return next();
    }

    return res.status(403).json({
      message: "Not authorized to manage financials",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to validate finance permissions",
    });
  }
};

financialsRouter.post(
  "/upsert-approval-config",
  [protect, permissions.can_manage_financials],
  controller.upsertApprovalConfig,
);
financialsRouter.get(
  "/get-approval-config",
  [protect, permissions.can_view_financials],
  controller.getApprovalConfig,
);
financialsRouter.post(
  "/create-financial",
  [protect, canManageFinancialsOrActAsApprover],
  controller.create,
);
financialsRouter.get(
  "/get-financials",
  [protect, permissions.can_view_financials],
  controller.findAll,
);
financialsRouter.get(
  "/get-financial",
  [protect, permissions.can_view_financials],
  controller.findOne,
);
financialsRouter.put(
  "/update-financial",
  [protect, canManageFinancialsOrActAsApprover],
  controller.update,
);
financialsRouter.delete(
  "/delete-financial",
  [protect, permissions.can_delete_financials],
  controller.delete,
);

export default financialsRouter;
