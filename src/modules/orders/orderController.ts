import { Request, Response } from "express";
import { OrderService, InsufficientStockError } from "./orderService";
import { isPaystackFailure } from "../../libs/paystack/paystackClient";

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
      const status = error instanceof InsufficientStockError
        ? 409
        : isPaystackFailure(error)
        ? error.statusCode
        : 400;
      return res.status(status).json({
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
      const clientReference = String(Data?.ClientReference || "").trim();

      if (!clientReference) {
        return res
          .status(400)
          .json({ message: "Invalid webhook payload", result: null });
      }

      // Do not trust callback payload status directly.
      // Confirm the latest transaction status against Hubtel before updating.
      const result = await orderService.checkHubtelTransactionStatus(
        clientReference,
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
        message: "Payment reinitiated successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create order",
      });
    }
  }

  async retryPayment(req: Request, res: Response) {
    try {
      const { id, return_url, cancellation_url } = req.body;
      const order = await orderService.retryHubtelPayment(
        id,
        return_url,
        cancellation_url,
      );
      return res.status(201).json({
        message: "Payment retried successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to retry payment",
      });
    }
  }

  async reconcilePendingHubtelPayments(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit ?? 100);
      const safeLimit = Number.isNaN(limit) ? 100 : Math.min(Math.max(limit, 1), 500);
      const result = await orderService.reconcilePendingHubtelPayments(safeLimit);

      return res.status(200).json({
        success: true,
        message: "Pending Hubtel payments reconciled",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to reconcile pending Hubtel payments",
      });
    }
  }

  async updateDeliveryStatus(req: Request, res: Response) {
    try {
      const { id, status } = req.body as { id?: number | string; status?: string };
      const orderId = Number(id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "A valid order id is required" });
      }
      if (typeof status !== "string" || !status.trim()) {
        return res.status(400).json({ message: "Delivery status is required" });
      }

      const actorUserId = Number((req as any)?.user?.id);
      const updatedOrder = await orderService.updateDeliveryStatus(
        orderId,
        status.trim().toLowerCase() as
          | "pending"
          | "shipped"
          | "delivered"
          | "cancelled",
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );

      return res.status(200).json({
        message: "Delivery status updated successfully",
        data: updatedOrder,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: error.message || "Failed to update delivery status",
      });
    }
  }

  async cancelOrder(req: Request, res: Response) {
    try {
      const { id } = req.body as { id?: number | string };
      const orderId = Number(id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "A valid order id is required" });
      }

      const actorUserId = Number((req as any)?.user?.id);
      const updatedOrder = await orderService.cancelOrder(
        orderId,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );

      return res.status(200).json({
        message: "Order cancelled successfully",
        data: updatedOrder,
      });
    } catch (error: any) {
      return res.status(400).json({
        message: error.message || "Failed to cancel order",
      });
    }
  }

  async updateOrder(req: Request, res: Response) {
    try {
      const { id, billing, payment_status, delivery_status, items } = req.body;
      const orderId = Number(id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "A valid order id is required" });
      }

      if (
        payment_status !== undefined &&
        !["pending", "success", "failed"].includes(payment_status)
      ) {
        return res.status(400).json({
          message: "payment_status must be pending, success, or failed",
        });
      }
      if (
        delivery_status !== undefined &&
        !["pending", "shipped", "delivered", "cancelled"].includes(delivery_status)
      ) {
        return res.status(400).json({
          message: "delivery_status must be pending, shipped, delivered, or cancelled",
        });
      }

      const updatedOrder = await orderService.updateOrder({
        id: orderId,
        billing,
        payment_status,
        delivery_status,
        items,
      });

      return res.status(200).json({
        message: "Order updated successfully",
        data: updatedOrder,
      });
    } catch (error: any) {
      const status = error instanceof InsufficientStockError ? 409 : 400;
      return res.status(status).json({
        message: error.message || "Failed to update order",
      });
    }
  }

  async deleteOrder(req: Request, res: Response) {
    try {
      const orderId = Number(req.query.id ?? req.body?.id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "A valid order id is required" });
      }

      const actorUserId = Number((req as any)?.user?.id);
      await orderService.deleteOrder(
        orderId,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );
      return res.status(200).json({ message: "Order deleted successfully" });
    } catch (error: any) {
      return res.status(400).json({
        message: error.message || "Failed to delete order",
      });
    }
  }

  async bulkDeleteOrders(req: Request, res: Response) {
    try {
      const rawIds = String(req.query.ids ?? "");
      const orderIds = rawIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);

      if (orderIds.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one valid order id is required" });
      }
      if (orderIds.length > 500) {
        return res
          .status(400)
          .json({ message: "Cannot delete more than 500 orders at once" });
      }

      const actorUserId = Number((req as any)?.user?.id);
      const result = await orderService.bulkDeleteOrders(
        orderIds,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );
      return res.status(200).json({
        message: "Orders deleted successfully",
        data: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error.message || "Failed to delete orders",
      });
    }
  }

  async createForMember(req: Request, res: Response) {
    try {
      const actorUserId = Number((req as any)?.user?.id);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return res
          .status(400)
          .json({ message: "Unable to identify the staff placing this order" });
      }

      const order = await orderService.createForMember({
        ...req.body,
        placed_by_staff_id: actorUserId,
      });

      return res.status(201).json({
        message: "Order placed successfully",
        data: order,
      });
    } catch (error: any) {
      const status = error instanceof InsufficientStockError
        ? 409
        : isPaystackFailure(error)
        ? error.statusCode
        : 400;
      return res.status(status).json({
        message: error.message || "Failed to place order",
      });
    }
  }
}
