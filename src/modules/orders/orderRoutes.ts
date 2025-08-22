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
 *               reference:
 *                 type: string
 *                 example: "txn_ref_12345"
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
 *                     market_id: { type: integer, example: 101}
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
 *  get:
 *    summary: Verify a payment
 *    description: Verify an order payment using a payment reference.
 *    tags:
 *      - Orders
 *    parameters:
 *      - in: query
 *        name: reference
 *        required: true
 *        schema:
 *          type: string
 *        description: Payment reference provided by the payment gateway
 *    responses:
 *      "200":
 *        description: Payment verified successfully
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                success:
 *                  type: boolean
 *                  example: true
 *                data:
 *                  type: object
 *                  description: Order details with payment status
 *      "400":
 *        description: Payment verification failed
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                success:
 *                  type: boolean
 *                  example: false
 *                message:
 *                  type: string
 *                  example: "Payment verification failed"
 */

orderRouter.put("/verify-payment", orderController.verifyPayment);

export default orderRouter;
