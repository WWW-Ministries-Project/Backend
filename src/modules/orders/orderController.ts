import { Request, Response } from "express";
import { OrderService } from "./orderService";

const orderService = new OrderService();

export class OrderController {
  // Create a new order
  async create(req: Request, res: Response) {
    try {
      const order = await orderService.create(req.body);
      return res.status(201).json({
        message: "Order created successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create order",
      });
    }
  }

  // Get all orders
  async findAll(req: Request, res: Response) {
    try {
      const orders = await orderService.findAll();
      return res.status(200).json({
        message: "Orders retrieved successfully",
        data: orders,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error.message || "Failed to fetch orders",
      });
    }
  }

  // Get order by ID
  async findOne(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const order = await orderService.findOne(Number(id));
      return res.status(200).json({
        message: "Order retrieved successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(404).json({
        message: error.message || "Order not found",
      });
    }
  }

  // Get orders by User ID
  async findByUserId(req: Request, res: Response) {
    try {
      const userId = parseInt(req.query.user_id as string);
      const orders = await orderService.findByUserId(userId);
      return res.status(200).json({
        message: "Orders retrieved successfully",
        data: orders,
      });
    } catch (error: any) {
      return res.status(404).json({
        message: error.message || "No orders found for this user",
      });
    }
  }

  // Get orders by Marketplace ID
  async findByMarketplaceId(req: Request, res: Response) {
    try {
      const marketId = parseInt(req.query.market_id as string);
      const orders = await orderService.findOneByMarketplaceId(marketId);
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        message: error.message || "No orders found for this marketplace",
      });
    }
  }
  async findByName(req: Request, res: Response) {
    try {
      const first_name = req.query.first_name as string;
      const last_name = req.query.last_name as string;
      const orders = await orderService.findOrderByName(first_name, last_name);
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        message: error.message || "No orders found for this name",
      });
    }
  }

  async verifyPayment(req: Request, res: Response) {
    try {
      const order_number = req.query.order_number as string;
      const order = await orderService.verifyPaymentStatus(order_number);
      return res.status(200).json({
        message: order.message,
        data: order.order,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: error.message || "Payment verification failed",
      });
    }
  }

  async hubtelWebhook(req: Request, res: Response) {
    try {
      const { Data } = req.body;
      console.log(`Call Back ${Data}`)
      console.log(JSON.stringify(Data, null, 2));
      const status = Data.Status === "Success" ? "success" : "failed";

      const result = await orderService.updateOrderStatusByHubtel(
        Data.ClientReference,
        status,
      );

      res.status(200).json({ message: "Callback processed", result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async confirmTransaction(req: Request, res: Response) {
    try {
      const { reference } = req.query as { reference?: string };

      if (!reference) {
        return res.status(400).json({ error: "Reference is required" });
      }

      const response =
        await orderService.checkHubtelTransactionStatus(reference);

      return res.status(200).json({
        message: "Transaction confirmed",
        data: response,
      });
    } catch (error: any) {
      console.error("Error confirming transaction:", error.message);
      return res.status(500).json({ error: "Failed to confirm transaction" });
    }
  }

  async confirmTransactionById(req: Request, res: Response) {
    try {
      const { id } = req.query as { id?: string };

      if (!id) {
        return res.status(400).json({ error: "Id is required" });
      }

      const response = await orderService.checkHubtelTransactionStatusById(
        Number(id),
      );

      return res.status(200).json({
        message: "Transaction confirmed",
        data: response,
      });
    } catch (error: any) {
      console.error("Error confirming transaction:", error.message);
      return res.status(500).json({ error: "Failed to confirm transaction" });
    }
  }

  async reinitiatePayment(req: Request, res: Response) {
    try {
      const { id, return_url, cancellation_url } = req.body;
      const order = await orderService.reinitiatePayment(
        id,
        return_url,
        cancellation_url,
      );
      return res.status(201).json({
        message: "Order created successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create order",
      });
    }
  }
}
