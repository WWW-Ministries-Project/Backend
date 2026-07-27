import { Router } from "express";
import { GivingOptionController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";

const givingOptionRouter = Router();
const controller = new GivingOptionController();
const permissions = new Permissions();
const protect = permissions.protect;

/**
 * @swagger
 * tags:
 *   name: Giving Options
 *   description: Giving options and the Paystack subaccounts payments are routed to
 */

/**
 * @swagger
 * /givingoption/banks:
 *   get:
 *     summary: List Paystack banks and mobile money providers
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           default: GHS
 *       - in: query
 *         name: branch_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bank list (cached server-side for 24 hours)
 *       502:
 *         description: Paystack unreachable
 */
givingOptionRouter.get(
  "/banks",
  [protect, permissions.can_manage_giving],
  controller.listBanks,
);

/**
 * @swagger
 * /givingoption/resolve-account:
 *   get:
 *     summary: Best-effort account name lookup
 *     description: >
 *       Returns null data when Paystack cannot resolve the account. Callers must
 *       treat this as a convenience only and never block on it.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: account_number
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: bank_code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resolved account, or null when lookup is unavailable
 */
givingOptionRouter.get(
  "/resolve-account",
  [protect, permissions.can_manage_giving],
  controller.resolveAccount,
);

/**
 * @swagger
 * /givingoption/create-giving-option:
 *   post:
 *     summary: Create a giving option and its Paystack subaccount
 *     description: >
 *       Payments are routed, not split: the subaccount is created with
 *       percentage_charge 100 so the full amount settles to this account.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, settlement_bank, bank_name, account_number, account_name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Building Fund
 *               description:
 *                 type: string
 *               account_type:
 *                 type: string
 *                 enum: [ghipss, mobile_money]
 *               settlement_bank:
 *                 type: string
 *                 description: Paystack bank or provider code
 *               bank_name:
 *                 type: string
 *               account_number:
 *                 type: string
 *               account_name:
 *                 type: string
 *               currency:
 *                 type: string
 *                 default: GHS
 *               branch_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Created
 *       409:
 *         description: An active giving option already uses this name
 *       422:
 *         description: Validation failed, or Paystack rejected the settlement account
 *       502:
 *         description: Paystack unreachable
 */
givingOptionRouter.post(
  "/create-giving-option",
  [protect, permissions.can_manage_giving],
  controller.create,
);

/**
 * @swagger
 * /givingoption/get-giving-options:
 *   get:
 *     summary: List giving options
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: take
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: branch_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: include_archived
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: Paginated giving options
 */
givingOptionRouter.get(
  "/get-giving-options",
  [protect, permissions.can_view_giving],
  controller.findAll,
);

/**
 * @swagger
 * /givingoption/update-giving-option:
 *   put:
 *     summary: Update a giving option and sync its Paystack subaccount
 *     tags: [Giving Options]
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
 *         description: Updated
 *       404:
 *         description: Giving option not found
 *       409:
 *         description: Name clash, or the option is archived
 */
givingOptionRouter.put(
  "/update-giving-option",
  [protect, permissions.can_manage_giving],
  controller.update,
);

/**
 * @swagger
 * /givingoption/restore-giving-option:
 *   put:
 *     summary: Restore an archived giving option
 *     description: Fails if the Paystack subaccount cannot be reactivated.
 *     tags: [Giving Options]
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
 *         description: Restored
 */
givingOptionRouter.put(
  "/restore-giving-option",
  [protect, permissions.can_manage_giving],
  controller.restore,
);

/**
 * @swagger
 * /givingoption/delete-giving-option:
 *   delete:
 *     summary: Archive a giving option (soft delete)
 *     description: >
 *       Paystack has no delete-subaccount endpoint, so the subaccount is
 *       deactivated instead. The local archive succeeds even if Paystack is
 *       unreachable; the response message says so when that happens.
 *     tags: [Giving Options]
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
 *         description: Archived
 */
givingOptionRouter.delete(
  "/delete-giving-option",
  [protect, permissions.can_delete_giving],
  controller.archive,
);

/**
 * @swagger
 * /givingoption/{id}:
 *   get:
 *     summary: Fetch a single giving option
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Giving option
 *       404:
 *         description: Not found
 */
givingOptionRouter.get(
  "/:id",
  [protect, permissions.can_view_giving],
  controller.findOne,
);

export default givingOptionRouter;
