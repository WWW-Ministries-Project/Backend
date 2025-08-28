import { Router } from "express";
import { OrderController } from "./orderController";

const orderRouter = Router();
const orderController = new OrderController();

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order management endpoints
 */

/**
 * @swagger
 * /orders/create-order:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: integer
 *                 example: 1
 *               total_amount:
 *                 type: number
 *                 example: 5000
 *               payment_type:
 *                 type: string
 *                 example: "paystack"
 *               return_url:
 *                 type: string
 *                 example: "https://yourapp.com/return"
 *               cancellation_url:
 *                  type: string
 *                  example: "https://yourapp.com/cancel"
 *               billing:
 *                 type: object
 *                 properties:
 *                   first_name: { type: string, example: "John" }
 *                   last_name: { type: string, example: "Doe" }
 *                   email: { type: string, example: "john@example.com" }
 *                   phone_number: { type: string, example: "+1234567890" }
 *                   country: { type: string, example: "Nigeria" }
 *                   country_code: { type: string, example: "NG" }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string, example: "T-shirt" }
 *                     prduct_id: { type: string, example: "PRD123" }
 *                     price_amount: { type: number, example: 2000 }
 *                     price_currency: { type: string, example: "NGN" }
 *                     quantity: { type: integer, example: 2 }
 *                     product_type: { type: string, example: "clothing" }
 *                     product_category: { type: string, example: "fashion" }
 *                     image_url: { type: string, example: "https://example.com/image.png" }
 *                     color: { type: string, example: "red" }
 *                     size: { type: string, example: "L" }
 *     responses:
 *       201:
 *         description: Order created successfully
 *       400:
 *         description: Failed to create order
 */
orderRouter.post("/create-order", orderController.create);

/**
 * @swagger
 * /orders/get-all-orders:
 *   get:
 *     summary: Get all orders
 *     tags: [Orders]
 *     responses:
 *       200:
 *         description: List of orders
 */
orderRouter.get("/get-all-orders", orderController.findAll);

/**
 * @swagger
 * /orders/get-order-by-id:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
orderRouter.get("/get-order-by-id", orderController.findOne);

/**
 * @swagger
 * /orders/get-orders-by-user:
 *   get:
 *     summary: Get orders by User ID
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *         required: true
 *         description: User ID
 *     responses:
 *       200:
 *         description: Orders for the user
 *       404:
 *         description: No orders found for this user
 */
orderRouter.get("/get-orders-by-user", orderController.findByUserId);

/**
 * @swagger
 * /orders/get-orders-by-market:
 *   get:
 *     summary: Get orders by Marketplace ID
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: market_id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Marketplace ID
 *     responses:
 *       200:
 *         description: Orders for the marketplace
 *       404:
 *         description: No orders found for this marketplace
 */
orderRouter.get("/get-orders-by-market", orderController.findByMarketplaceId);

/**
 * @swagger
 * /orders/verify-payment:
 *   get:
 *     summary: Verify a payment
 *     description: Verify an order payment using a payment reference.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference provided by the payment gateway
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Order details with payment status
 *       400:
 *         description: Payment verification failed, this is for paystack
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Payment verification failed"
 */
orderRouter.get("/verify-payment", orderController.verifyPayment);

/**
 * @swagger
 * /orders/hubtel-payment-webhook:
 *   post:
 *     summary: Hubtel payment webhook callback
 *     tags: [Orders]
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 */
orderRouter.post("/hubtel-payment-webhook", orderController.hubtelWebhook);
/**
 * @swagger
 * /orders/hubtel-transaction-status:
 *   get:
 *     summary: Check transaction status from Hubtel
 *     description: >
 *       Checks the status of a transaction from Hubtel's Transaction Status API using only the client reference.
 *       Requires whitelisted IP and valid Basic Auth credentials.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: clientReference
 *         required: true
 *         schema:
 *           type: string
 *         description: Client reference you provided when initiating the transaction.
 *     responses:
 *       200:
 *         description: Hubtel transaction status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Successful
 *                 responseCode:
 *                   type: string
 *                   example: "0000"
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       example: "2024-04-25T21:45:48.4740964Z"
 *                     status:
 *                       type: string
 *                       example: Paid
 *                     transactionId:
 *                       type: string
 *                     externalTransactionId:
 *                       type: string
 *                     paymentMethod:
 *                       type: string
 *                     clientReference:
 *                       type: string
 *                     currencyCode:
 *                       type: string
 *                       nullable: true
 *                     amount:
 *                       type: number
 *                     charges:
 *                       type: number
 *                     amountAfterCharges:
 *                       type: number
 *                     isFulfilled:
 *                       type: boolean
 *                       nullable: true
 *       400:
 *         description: Bad request (missing clientReference)
 *       403:
 *         description: Forbidden (IP not whitelisted)
 *       500:
 *         description: Hubtel API error
 */
orderRouter.get(
  "/confirm-transaction-status",
  orderController.confirmTransaction,
);

export default orderRouter;
