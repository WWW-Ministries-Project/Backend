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
 * /orders/confirm-transaction-status:
 *   get:
 *     summary: Check transaction status from Hubtel
 *     description: >
 *       Checks the status of a transaction from Hubtel's Transaction Status API using only the client reference.
 *       Requires whitelisted IP and valid Basic Auth credentials.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Client reference you provided when initiating the transaction.
 *     responses:
 *       200:
 *         description: Transaction confirmation response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Transaction confirmed
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Payment status updated to failed
 *                     order:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 74
 *                         order_number:
 *                           type: string
 *                           example: "#WWM-20250902-000074"
 *                         total_amount:
 *                           type: number
 *                           example: 0.1
 *                         user_id:
 *                           type: integer
 *                           example: 2
 *                         payment_status:
 *                           type: string
 *                           example: failed
 *                         delivery_status:
 *                           type: string
 *                           example: pending
 *                         created_at:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-09-02T17:57:16.363Z"
 *                         updated_at:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-09-02T17:59:24.100Z"
 *                         reference:
 *                           type: string
 *                           example: "f9fb0034-57c3-47a8-a9fb-4474107ecdb5"
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 76
 *                               order_id:
 *                                 type: integer
 *                                 example: 74
 *                               name:
 *                                 type: string
 *                                 example: "Headset"
 *                               market_id:
 *                                 type: integer
 *                                 example: 25
 *                               product_id:
 *                                 type: integer
 *                                 nullable: true
 *                               price_amount:
 *                                 type: number
 *                                 example: 0.1
 *                               price_currency:
 *                                 type: string
 *                                 example: ""
 *                               quantity:
 *                                 type: integer
 *                                 example: 1
 *                               product_type:
 *                                 type: string
 *                                 example: "Wearables"
 *                               product_category:
 *                                 type: string
 *                                 example: "Todlers"
 *                               image_url:
 *                                 type: string
 *                                 example: "https://res.cloudinary.com/dt8vgj0u3/image/upload/v1756285069/www-ministires/etb8naheuq9l6pumgnje.png"
 *                               color:
 *                                 type: string
 *                                 example: "#8dd1ff"
 *                               size:
 *                                 type: string
 *                                 example: "M"
 *                         billing_details:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                               example: 71
 *                             order_id:
 *                               type: integer
 *                               example: 74
 *                             first_name:
 *                               type: string
 *                               example: "Asiedu"
 *                             last_name:
 *                               type: string
 *                               example: "Ayettey"
 *                             email:
 *                               type: string
 *                               example: "black@sherif.com"
 *                             phone_number:
 *                               type: string
 *                               example: "555207699"
 *                             country:
 *                               type: string
 *                               example: "Austria"
 *                             country_code:
 *                               type: string
 *                               example: "+233"
 *       400:
 *         description: Bad request (missing or invalid ID)
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */

orderRouter.get(
  "/confirm-transaction-status",
  orderController.confirmTransaction,
);
/**
 * @swagger
 * /orders/confirm-transaction-status-by-id:
 *   get:
 *     summary: Confirm a transaction by ID
 *     description: >
 *       Confirms the status of a transaction by updating the payment status of an order.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The order ID to confirm the transaction for.
 *     responses:
 *       200:
 *         description: Transaction confirmation response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Transaction confirmed
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Payment status updated to failed
 *                     order:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 74
 *                         order_number:
 *                           type: string
 *                           example: "#WWM-20250902-000074"
 *                         total_amount:
 *                           type: number
 *                           example: 0.1
 *                         user_id:
 *                           type: integer
 *                           example: 2
 *                         payment_status:
 *                           type: string
 *                           example: failed
 *                         delivery_status:
 *                           type: string
 *                           example: pending
 *                         created_at:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-09-02T17:57:16.363Z"
 *                         updated_at:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-09-02T17:59:24.100Z"
 *                         reference:
 *                           type: string
 *                           example: "f9fb0034-57c3-47a8-a9fb-4474107ecdb5"
 *                         items:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 76
 *                               order_id:
 *                                 type: integer
 *                                 example: 74
 *                               name:
 *                                 type: string
 *                                 example: "Headset"
 *                               market_id:
 *                                 type: integer
 *                                 example: 25
 *                               product_id:
 *                                 type: integer
 *                                 nullable: true
 *                               price_amount:
 *                                 type: number
 *                                 example: 0.1
 *                               price_currency:
 *                                 type: string
 *                                 example: ""
 *                               quantity:
 *                                 type: integer
 *                                 example: 1
 *                               product_type:
 *                                 type: string
 *                                 example: "Wearables"
 *                               product_category:
 *                                 type: string
 *                                 example: "Todlers"
 *                               image_url:
 *                                 type: string
 *                                 example: "https://res.cloudinary.com/dt8vgj0u3/image/upload/v1756285069/www-ministires/etb8naheuq9l6pumgnje.png"
 *                               color:
 *                                 type: string
 *                                 example: "#8dd1ff"
 *                               size:
 *                                 type: string
 *                                 example: "M"
 *                         billing_details:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                               example: 71
 *                             order_id:
 *                               type: integer
 *                               example: 74
 *                             first_name:
 *                               type: string
 *                               example: "Asiedu"
 *                             last_name:
 *                               type: string
 *                               example: "Ayettey"
 *                             email:
 *                               type: string
 *                               example: "black@sherif.com"
 *                             phone_number:
 *                               type: string
 *                               example: "555207699"
 *                             country:
 *                               type: string
 *                               example: "Austria"
 *                             country_code:
 *                               type: string
 *                               example: "+233"
 *       400:
 *         description: Bad request (missing or invalid ID)
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */

orderRouter.get(
  "/confirm-transaction-status-by-id",
  orderController.confirmTransactionById,
);

/**
 * @swagger
 * /orders/reinitiate-payment:
 *   post:
 *     summary: Reinitiate a Hubtel payment for an existing order
 *     description: >
 *       Generates a new client reference for the order, updates it in the database,
 *       and reinitializes the Hubtel transaction.
 *       Returns Hubtel checkout details and updated order reference.
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - return_url
 *               - cancellation_url
 *             properties:
 *               id:
 *                 type: integer
 *                 example: 123
 *                 description: ID of the order to reinitiate payment for
 *               return_url:
 *                 type: string
 *                 format: uri
 *                 example: "https://yourapp.com/payment/success"
 *                 description: URL Hubtel will redirect to after successful payment
 *               cancellation_url:
 *                 type: string
 *                 format: uri
 *                 example: "https://yourapp.com/payment/cancel"
 *                 description: URL Hubtel will redirect to if the payment is cancelled
 *     responses:
 *       201:
 *         description: Hubtel payment successfully reinitiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Order created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Hubtel payment initiated"
 *                     checkoutUrl:
 *                       type: string
 *                       example: "https://checkout.hubtel.com/payment/xyz"
 *                     checkoutDirectUrl:
 *                       type: string
 *                       example: "https://checkout.hubtel.com/direct/xyz"
 *                     clientReference:
 *                       type: string
 *                       example: "REF_987654321"
 *                     checkoutId:
 *                       type: string
 *                       example: "CHK123456789"
 *                     updated_order:
 *                       type: object
 *                       description: Updated order object from the database
 *       400:
 *         description: Failed to reinitiate payment
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
 *                   example: "Failed to create order"
 */

orderRouter.post("/reinitiate-payment", orderController.reinitiatePayment);
orderRouter.post(
  "/reconcile-hubtel-pending-payments",
  orderController.reconcilePendingHubtelPayments,
);

export default orderRouter;
