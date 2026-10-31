import { NextFunction, Request, Response, Router } from "express";
import { FinancialsController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { prisma } from "../../../Models/context";
import { actionAllowed } from "../../../permissions/access";
import { financePermissions } from "../financeAccess";

const financialsRouter = Router();
const controller = new FinancialsController();
const permissions = new Permissions();
const protect = permissions.protect;

/**
 * Saving a weekly record needs `create_draft` or `submit` (the service checks
 * which one the save uses), or being the configured finance approver, who
 * could always open and fix records. Runs after `withAccess`, so the live
 * permissions are used, not the login token's.
 */
const canSaveFinancialsOrActAsApprover = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const live = financePermissions(req);
    if (
      actionAllowed(live, "Financials", "create_draft") ||
      actionAllowed(live, "Financials", "submit")
    ) {
      return next();
    }

    const actorUserId = Number((req as any).user?.id);
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

    if (
      config?.finance_approver_user_id === actorUserId &&
      actionAllowed(live, "Financials", "approve")
    ) {
      return next();
    }

    return res.status(403).json({
      message: "Not authorized to manage financials",
      code: "ACTION_FORBIDDEN",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to validate finance permissions",
    });
  }
};

financialsRouter.post(
  "/upsert-approval-config",
  // Who approves needs Financials.configure_approvals; the tithe rate saved
  // here too needs Financials.configure. The service checks which changed.
  [protect, permissions.withAccess],
  controller.upsertApprovalConfig,
);
financialsRouter.get(
  "/get-approval-config",
  [protect, permissions.can_view_financials],
  controller.getApprovalConfig,
);
financialsRouter.post(
  "/create-financial",
  [protect, permissions.withAccess, canSaveFinancialsOrActAsApprover],
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
  [protect, permissions.withAccess, canSaveFinancialsOrActAsApprover],
  controller.update,
);
/**
 * @swagger
 * /financials/approve-financial:
 *   post:
 *     summary: Finance approver approves a submitted weekly record
 *     tags: [Financials]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Approved record
 *       403:
 *         description: Caller is not the finance approver
 *       409:
 *         description: Record is not waiting for approval
 */
financialsRouter.post(
  "/approve-financial",
  [
    protect,
    permissions.requireAction(
      "Financials",
      "approve",
      "Not authorized to review financial records",
    ),
  ],
  controller.approve,
);
/**
 * @swagger
 * /financials/return-financial:
 *   post:
 *     summary: Finance approver returns a submitted weekly record as a draft
 *     tags: [Financials]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returned record (status DRAFT, return_note set)
 */
financialsRouter.post(
  "/return-financial",
  [
    protect,
    permissions.requireAction(
      "Financials",
      "approve",
      "Not authorized to review financial records",
    ),
  ],
  controller.returnRecord,
);
/**
 * @swagger
 * /financials/auto-amounts:
 *   get:
 *     summary: Online giving and pledges redeemed for one week (major units)
 *     tags: [Financials]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: branch_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Totals for the week
 */
financialsRouter.get(
  "/auto-amounts",
  [protect, permissions.can_view_financials],
  controller.autoAmounts,
);
financialsRouter.delete(
  "/delete-financial",
  [
    protect,
    permissions.requireAction(
      "Financials",
      "delete",
      "Not authorized to delete financial records",
    ),
  ],
  controller.delete,
);

export default financialsRouter;
