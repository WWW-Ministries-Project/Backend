import { Request, Response } from "express";
import { OrderService, InsufficientStockError, OrderConflictError } from "./orderService";
import { isPaystackFailure } from "../../libs/paystack/paystackClient";
import { getMarketplaceDeliveryConfig } from "./marketplaceFulfilment";
import {
  assertMarketBranchAccessible,
  assertOrderBranchAccessible,
  marketplaceActionAllowed,
} from "./marketplaceAccess";
import { BranchAccessError } from "../branches/branchService";

const forbidden = (res: Response, message: string) =>
  res.status(403).json({ message, data: null, code: "ACTION_FORBIDDEN" });

/** 403 for a record outside the caller's branches, else the given status. */
const errorStatus = (error: unknown, fallback: number) =>
  error instanceof BranchAccessError ? 403 : fallback;

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
      const orders = await orderService.findAll(req.query?.branch_id);
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
      // Staff reading any order stay inside their branches; owners read their own.
      if ((req as any).orderScope?.mode === "all") {
        await assertOrderBranchAccessible(Number(id));
      }
      const order = await orderService.findOne(Number(id));
      return res.status(200).json({
        message: "Order retrieved successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(errorStatus(error, 404)).json({
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
      await assertMarketBranchAccessible(marketId);
      const orders = await orderService.findOneByMarketplaceId(marketId);
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(errorStatus(error, 404)).json({
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

      await assertOrderBranchAccessible(Number(id));
      const response = await orderService.checkHubtelTransactionStatusById(
        Number(id),
      );

      return res.status(200).json({
        message: "Transaction confirmed",
        data: response,
      });
    } catch (error: any) {
      if (error instanceof BranchAccessError) {
        return res.status(403).json({ message: error.message, data: null });
      }
      console.error("Error confirming transaction:", error.message);
      return res.status(500).json({ error: "Failed to confirm transaction" });
    }
  }

  async reinitiatePayment(req: Request, res: Response) {
    try {
      const { id, return_url, cancellation_url } = req.body;
      await assertOrderBranchAccessible(Number(id));
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
      return res.status(errorStatus(error, 400)).json({
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
      const marketId = Number(req.query.market_id);
      if (Number.isInteger(marketId) && marketId > 0) {
        await assertMarketBranchAccessible(marketId);
      }
      const result =
        Number.isInteger(marketId) && marketId > 0
          ? await orderService.reconcilePendingHubtelPaymentsByMarket(marketId, safeLimit)
          : await orderService.reconcilePendingHubtelPayments(safeLimit);

      return res.status(200).json({
        success: true,
        message: "Pending Hubtel payments reconciled",
        data: result,
      });
    } catch (error: any) {
      return res.status(errorStatus(error, 500)).json({
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

      if (
        status.trim().toLowerCase() === "cancelled" &&
        !marketplaceActionAllowed(req, "cancel_any_order")
      ) {
        return forbidden(res, "You can't cancel orders");
      }
      await assertOrderBranchAccessible(orderId);
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
      return res.status(errorStatus(error, 400)).json({
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
      // Staff cancelling someone else's order need cancel_any_order and the
      // order's branch; members cancel their own.
      const owner = await orderService.findOrderOwner(orderId);
      if (owner !== null && owner.user_id !== actorUserId) {
        if (!marketplaceActionAllowed(req, "cancel_any_order")) {
          return forbidden(res, "You can't cancel other people's orders");
        }
        await assertOrderBranchAccessible(orderId);
      }
      const updatedOrder = await orderService.cancelOrder(
        orderId,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );

      return res.status(200).json({
        message: "Order cancelled successfully",
        data: updatedOrder,
      });
    } catch (error: any) {
      return res.status(errorStatus(error, 400)).json({
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

      // Each part of the edit is its own action.
      const editingItems = Array.isArray(items) && items.length > 0;
      if (!editingItems && !billing && payment_status === undefined && delivery_status === undefined) {
        return res.status(400).json({ message: "Nothing to update" });
      }
      if ((editingItems || billing) && !marketplaceActionAllowed(req, "edit_order_items")) {
        return forbidden(res, "You can't edit order items or billing details");
      }
      if (payment_status !== undefined && !marketplaceActionAllowed(req, "mark_paid")) {
        return forbidden(res, "You can't change an order's payment status");
      }
      if (delivery_status !== undefined) {
        const action = delivery_status === "cancelled" ? "cancel_any_order" : "fulfil_order";
        if (!marketplaceActionAllowed(req, action)) {
          return forbidden(res, "You can't change an order's delivery status");
        }
      }
      await assertOrderBranchAccessible(orderId);

      const actorUserId = Number((req as any)?.user?.id);
      const updatedOrder = await orderService.updateOrder({
        id: orderId,
        billing,
        payment_status,
        delivery_status,
        items,
        actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      });

      return res.status(200).json({
        message: "Order updated successfully",
        data: updatedOrder,
      });
    } catch (error: any) {
      const status =
        error instanceof InsufficientStockError || error instanceof OrderConflictError
          ? 409
          : errorStatus(error, 400);
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

      await assertOrderBranchAccessible(orderId);
      const actorUserId = Number((req as any)?.user?.id);
      await orderService.deleteOrder(
        orderId,
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );
      return res.status(200).json({ message: "Order deleted successfully" });
    } catch (error: any) {
      return res.status(errorStatus(error, 400)).json({
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

      // A manual order recorded as already paid is marking it paid.
      if (
        req.body?.payment_mode === "manual" &&
        (req.body?.manual_status ?? "success") === "success" &&
        !marketplaceActionAllowed(req, "mark_paid")
      ) {
        return forbidden(res, "You can't record an order as paid. Save it as awaiting payment instead");
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

  // Public: fulfilment options for checkout (guests included).
  async getDeliveryConfig(_req: Request, res: Response) {
    const config = getMarketplaceDeliveryConfig();
    return res.status(200).json({
      message: "Delivery config retrieved successfully",
      data: {
        delivery_enabled: config.delivery_enabled,
        delivery_fee: config.delivery_fee,
        pickup_location: config.pickup_location,
      },
    });
  }

  async bulkUpdateStatus(req: Request, res: Response) {
    const { ids, payment_status, delivery_status } = (req.body ?? {}) as {
      ids?: unknown;
      payment_status?: unknown;
      delivery_status?: unknown;
    };

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ message: "ids must be a non-empty array of order ids" });
    }
    if (ids.length > 500) {
      return res
        .status(400)
        .json({ message: "Cannot update more than 500 orders at once" });
    }
    const orderIds = ids.map((value) => Number(value));
    if (orderIds.some((value) => !Number.isInteger(value) || value <= 0)) {
      return res
        .status(400)
        .json({ message: "Every id must be a positive integer" });
    }
    if (payment_status === undefined && delivery_status === undefined) {
      return res.status(400).json({
        message: "Provide payment_status and/or delivery_status",
      });
    }
    if (
      payment_status !== undefined &&
      !["pending", "success", "failed"].includes(payment_status as string)
    ) {
      return res.status(400).json({
        message: "payment_status must be pending, success, or failed",
      });
    }
    if (
      delivery_status !== undefined &&
      !["pending", "shipped", "delivered", "cancelled"].includes(
        delivery_status as string,
      )
    ) {
      return res.status(400).json({
        message:
          "delivery_status must be pending, shipped, delivered, or cancelled",
      });
    }

    if (payment_status !== undefined && !marketplaceActionAllowed(req, "mark_paid")) {
      return forbidden(res, "You can't change orders' payment status");
    }
    if (delivery_status !== undefined) {
      const action = delivery_status === "cancelled" ? "cancel_any_order" : "fulfil_order";
      if (!marketplaceActionAllowed(req, action)) {
        return forbidden(res, "You can't change orders' delivery status");
      }
    }

    try {
      const actorUserId = Number((req as any)?.user?.id);
      const result = await orderService.bulkUpdateStatus(
        orderIds,
        {
          payment_status: payment_status as
            | "pending"
            | "success"
            | "failed"
            | undefined,
          delivery_status: delivery_status as
            | "pending"
            | "shipped"
            | "delivered"
            | "cancelled"
            | undefined,
        },
        Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
      );
      return res.status(200).json({
        message: "Order statuses updated",
        data: { updated: result.updated, skipped: result.skipped },
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error.message || "Failed to update order statuses",
      });
    }
  }

  async marketplaceOverview(req: Request, res: Response) {
    const parseOptionalId = (value: unknown): number | undefined | null => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const marketId = parseOptionalId(req.query.market_id);
    const branchId = parseOptionalId(req.query.branch_id);
    if (marketId === null) {
      return res.status(400).json({ message: "market_id must be a positive integer" });
    }
    if (branchId === null) {
      return res.status(400).json({ message: "branch_id must be a positive integer" });
    }

    try {
      const overview = await orderService.getMarketplaceOverview({
        market_id: marketId,
        branch_id: branchId,
      });
      return res.status(200).json({
        message: "Marketplace overview retrieved successfully",
        data: overview,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: error.message || "Failed to load marketplace overview",
      });
    }
  }
}
