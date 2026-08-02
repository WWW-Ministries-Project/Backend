import { Router } from "express";
import { GivingOptionController } from "./controller";
import { Permissions } from "../../../middleWare/authorization";
import { PAYSTACK_WEBHOOK_ROUTE } from "../../../libs/paystack/paystackWebhook";
import { GivingContributionController } from "./contributionController";

const givingOptionRouter = Router();
const controller = new GivingOptionController();
const contributionController = new GivingContributionController();
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
 * /givingoption/paystack-webhook:
 *   post:
 *     summary: Paystack webhook receiver
 *     description: >
 *       Public route, authenticated by an HMAC SHA512 signature over the raw
 *       request body rather than by a bearer token. Answers 200 once the
 *       signature is valid, including for unknown references, so Paystack does
 *       not retry indefinitely. Answers 500 rather than 401 when the Paystack
 *       key is unconfigured, so Paystack keeps retrying instead of treating the
 *       event as permanently rejected.
 *     tags: [Giving Options]
 *     responses:
 *       200:
 *         description: Acknowledged
 *       401:
 *         description: Invalid or missing signature
 *       500:
 *         description: Paystack is not configured on the server
 */
givingOptionRouter.post(
  PAYSTACK_WEBHOOK_ROUTE,
  contributionController.webhook,
);

/**
 * @swagger
 * /givingoption/available:
 *   get:
 *     summary: Giving options the caller may give to
 *     description: >
 *       Active, non-archived, Paystack-synced options belonging to the caller's
 *       branch or to no branch at all. Any authenticated member may call this.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available giving options
 */
givingOptionRouter.get(
  "/available",
  [protect],
  contributionController.listAvailable,
);

/**
 * @swagger
 * /givingoption/initialize:
 *   post:
 *     summary: Start a giving payment
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [giving_option_id, amount]
 *             properties:
 *               giving_option_id:
 *                 type: string
 *               amount:
 *                 type: integer
 *                 description: Minor units (pesewas). Minimum 100.
 *     responses:
 *       201:
 *         description: Returns checkoutUrl and reference
 *       422:
 *         description: Validation failure, or Paystack rejected the request
 *       502:
 *         description: Paystack unreachable
 */
/**
 * @swagger
 * /givingoption/fee-preview:
 *   get:
 *     summary: What a donation will cost the donor
 *     description: >
 *       Returns the donation, the Paystack fee the donor covers on top, and the
 *       total their card will be charged. Creates nothing. The app shows this
 *       before the member commits, so the charge is never larger than they
 *       expect. Computed server-side so a client copy of the fee formula cannot
 *       drift from the configured rate.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: integer
 *         description: The donation in minor units (pesewas).
 *     responses:
 *       200:
 *         description: amount, fee and amount_charged in minor units
 *       422:
 *         description: Amount missing or out of range
 */
givingOptionRouter.get(
  "/fee-preview",
  [protect],
  contributionController.previewFee,
);

givingOptionRouter.post(
  "/initialize",
  [protect],
  contributionController.initialize,
);

/**
 * @swagger
 * /givingoption/my-contributions:
 *   get:
 *     summary: The caller's own giving history
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
 *     responses:
 *       200:
 *         description: Paginated contributions
 */
givingOptionRouter.get(
  "/my-contributions",
  [protect],
  contributionController.listMine,
);

/**
 * @swagger
 * /givingoption/my-contributions:
 *   delete:
 *     summary: Remove one of the caller's own unsuccessful attempts
 *     description: >
 *       Only the caller's own row, and only one that never collected money. A
 *       pending row is verified against Paystack first and refused (409) if it
 *       is still live or turns out to have succeeded, so a mobile money charge
 *       part-way through a USSD prompt can never be deleted out from under the
 *       webhook that will settle it.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Removed
 *       404:
 *         description: Unknown reference, or it belongs to another member
 *       409:
 *         description: The payment succeeded, or is still being processed
 */
givingOptionRouter.delete(
  "/my-contributions",
  [protect],
  contributionController.remove,
);

/**
 * @swagger
 * /givingoption/retry-payment:
 *   post:
 *     summary: Start a fresh attempt at one of the caller's failed payments
 *     description: >
 *       Reads the fund and the amount off the original row - a retry cannot
 *       become a different gift - and mints a NEW reference, because Paystack
 *       requires references to be unique per initialization. The failed attempt
 *       is left in place so it can still be produced in a dispute.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reference]
 *             properties:
 *               reference:
 *                 type: string
 *                 description: The reference of the attempt being retried
 *               client:
 *                 type: string
 *                 enum: [web, mobile]
 *                 default: mobile
 *     responses:
 *       201:
 *         description: Returns checkoutUrl and the new reference
 *       404:
 *         description: Unknown reference, or the giving option is no longer available
 *       409:
 *         description: The payment succeeded, or is still being processed
 */
givingOptionRouter.post(
  "/retry-payment",
  [protect],
  contributionController.retry,
);

/**
 * @swagger
 * /givingoption/contributions:
 *   get:
 *     summary: All contributions, for finance staff
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
 *         name: giving_option_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, success, failed, abandoned]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Paginated contributions
 */
givingOptionRouter.get(
  "/contributions",
  [protect, permissions.can_view_giving],
  contributionController.listAll,
);

/**
 * @swagger
 * /givingoption/verify/{reference}:
 *   get:
 *     summary: Verify and settle a payment on demand
 *     description: >
 *       Called when the donor returns from the Paystack page, so the app can
 *       show a result without waiting for the webhook. Settles through the same
 *       idempotent path, so whichever arrives first wins and the other no-ops.
 *     tags: [Giving Options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The settled contribution
 *       404:
 *         description: Unknown reference, or it belongs to another member
 */
givingOptionRouter.get(
  "/verify/:reference",
  [protect],
  contributionController.verify,
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
