import { Router } from "express";
import { Permissions } from "../../../middleWare/authorization";
import {
  deleteMyPledgePayment,
  initializePledgePayment,
  listMyPledgePayments,
  listMyPledges,
  listPledgePayments,
  previewPledgeFee,
  retryPledgePayment,
  verifyPledgePayment,
} from "./controller";

const permissions = new Permissions();
const protect = permissions.protect;
export const pledgePaymentsRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Pledge Payments
 *   description: Members redeeming their own pledges through Paystack
 */

/**
 * @swagger
 * /pledges/my-pledges:
 *   get:
 *     summary: Pledges the caller is personally a pledger on
 *     description: >
 *       Any authenticated member may call this - it returns only rows where the
 *       caller is the pledger. `can_be_paid_online` is the flag clients gate the
 *       Pay button on: it is false when the pledge has no live Paystack
 *       subaccount, or when nothing is outstanding.
 *     tags: [Pledge Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The caller's pledges with pledged, redeemed and remaining amounts
 */
pledgePaymentsRouter.get("/my-pledges", [protect], listMyPledges);

/**
 * @swagger
 * /pledges/payment-fee-preview:
 *   get:
 *     summary: What redeeming a given amount will cost the payer
 *     description: >
 *       Returns the redemption, the Paystack fee the payer covers on top, and
 *       the total their card will be charged. Creates nothing. Computed
 *       server-side so a client copy of the fee formula cannot drift from the
 *       configured rate.
 *     tags: [Pledge Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: integer
 *         description: Minor units (pesewas)
 *     responses:
 *       200:
 *         description: amount, fee and amount_charged in minor units
 *       400:
 *         description: Amount missing or out of range
 */
pledgePaymentsRouter.get("/payment-fee-preview", [protect], previewPledgeFee);

/**
 * @swagger
 * /pledges/initialize-payment:
 *   post:
 *     summary: Start a pledge redemption payment
 *     description: >
 *       Routed, not split: the whole redemption settles to the pledge's own
 *       subaccount and the payer covers the Paystack fee on top. The amount may
 *       not exceed the outstanding balance on the pledge.
 *     tags: [Pledge Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pledger_id, amount]
 *             properties:
 *               pledger_id:
 *                 type: integer
 *               amount:
 *                 type: integer
 *                 description: Minor units (pesewas). Minimum 100.
 *               client:
 *                 type: string
 *                 enum: [web, mobile]
 *                 default: mobile
 *                 description: Picks the post-payment landing page. Not a URL.
 *     responses:
 *       201:
 *         description: Returns checkoutUrl and reference
 *       404:
 *         description: No such pledge, or it does not belong to the caller
 *       409:
 *         description: The pledge cannot take online payments, or is fully redeemed
 *       422:
 *         description: Amount exceeds the outstanding balance, or Paystack rejected the request
 */
pledgePaymentsRouter.post("/initialize-payment", [protect], initializePledgePayment);

/**
 * @swagger
 * /pledges/my-pledge-payments:
 *   get:
 *     summary: The caller's own pledge payment history
 *     tags: [Pledge Payments]
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
 *         description: Paginated payments
 */
pledgePaymentsRouter.get("/my-pledge-payments", [protect], listMyPledgePayments);

/**
 * @swagger
 * /pledges/my-pledge-payments:
 *   delete:
 *     summary: Remove one of the caller's own unsuccessful payments
 *     description: >
 *       Only the caller's own row, and only one that never collected money. A
 *       pending row is verified against Paystack first and refused (409) if it
 *       is still live or turns out to have succeeded, so a mobile money charge
 *       part-way through a USSD prompt can never be deleted out from under the
 *       webhook that will settle it and write its redemption.
 *     tags: [Pledge Payments]
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
pledgePaymentsRouter.delete(
  "/my-pledge-payments",
  [protect],
  deleteMyPledgePayment,
);

/**
 * @swagger
 * /pledges/retry-payment:
 *   post:
 *     summary: Start a fresh attempt at one of the caller's failed payments
 *     description: >
 *       Reads the pledge and the amount off the original row - a retry cannot
 *       become a payment against a different pledge - and mints a NEW reference,
 *       because Paystack requires references to be unique per initialization.
 *       The outstanding balance is re-checked, so a retry of an amount redeemed
 *       another way in the meantime is refused rather than overpaying.
 *     tags: [Pledge Payments]
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
 *               client:
 *                 type: string
 *                 enum: [web, mobile]
 *                 default: mobile
 *     responses:
 *       201:
 *         description: Returns checkoutUrl and the new reference
 *       404:
 *         description: Unknown reference, or the pledge is no longer payable
 *       409:
 *         description: The payment succeeded, is still processing, or the pledge changed
 *       422:
 *         description: The amount now exceeds the outstanding balance
 */
pledgePaymentsRouter.post("/retry-payment", [protect], retryPledgePayment);

/**
 * @swagger
 * /pledges/pledge-payments:
 *   get:
 *     summary: Every online payment against one pledge, for finance staff
 *     tags: [Pledge Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pledge_id
 *         required: true
 *         schema:
 *           type: integer
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
 *         description: Paginated payments
 */
pledgePaymentsRouter.get(
  "/pledge-payments",
  [protect, permissions.can_view_pledges],
  listPledgePayments,
);

/**
 * @swagger
 * /pledges/verify-payment/{reference}:
 *   get:
 *     summary: Verify and settle a pledge payment on demand
 *     description: >
 *       Called when the payer returns from the Paystack page, so the app can
 *       show a result without waiting for the webhook. Settles through the same
 *       idempotent path, so whichever arrives first wins and the other no-ops.
 *       A successful settlement also writes the redemption against the pledger.
 *     tags: [Pledge Payments]
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
 *         description: The settled payment
 *       404:
 *         description: Unknown reference, or it belongs to another member
 */
pledgePaymentsRouter.get(
  "/verify-payment/:reference",
  [protect],
  verifyPledgePayment,
);
