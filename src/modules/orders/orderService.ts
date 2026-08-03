import { prisma } from "../../Models/context";
import axios from "axios";
import crypto from "crypto";
import { toSentenceCase } from "../../utils";
import { notificationService } from "../notifications/notificationService";
import { stockNotificationService } from "../products/stockNotificationService";

export type StockShortage = {
  name: string;
  color: string;
  size: string;
  requested: number;
  available: number;
};

export class InsufficientStockError extends Error {
  items: StockShortage[];

  constructor(items: StockShortage[]) {
    const summary = items
      .map(
        (item) =>
          `${item.name} (${item.color}/${item.size}): requested ${item.requested}, only ${item.available} available`,
      )
      .join("; ");
    super(`Insufficient stock — ${summary}`);
    this.name = "InsufficientStockError";
    this.items = items;
  }
}

type ResolvedOrderItem = {
  productId: number;
  color: string;
  size: string;
  name: string;
  quantity: number;
  stockManaged: boolean;
  productColourId: number | null;
  sizeId: number | null;
  availableStock: number;
};

export class OrderService {
  async findOrderByName(first_name?: string, last_name?: string) {
    const orders = await prisma.orders.findMany({
      where: {
        billing_details: {
          is: {
            ...(first_name ? { first_name: { contains: first_name } } : {}),
            ...(last_name ? { last_name: { contains: last_name } } : {}),
          },
        },
      },
      include: {
        items: {
          include: { product: true, market: true },
        },
        billing_details: true,
      },
    });
    return this.flattenOrders(orders);
  }
  // Create a new order
  async create(data: {
    user_id?: number | null | string;
    total_amount: number | string;
    payment_type: "paystack" | "hubtel" | null;
    return_url: string | null;
    cancellation_url: string | null;
    billing: {
      first_name: string;
      last_name: string;
      email: string;
      phone_number: string;
      country: string;
      country_code: string;
    };
    items: {
      market_id?: number | string;
      name: string;
      id: string;
      price_amount: number;
      price_currency: string;
      quantity: number;
      product_type: string;
      product_category: string;
      image_url: string;
      color: string;
      size: string;
    }[];
  }) {
    if (data.payment_type === "hubtel") {
      this.validateHubtelRedirectUrls(data.return_url, data.cancellation_url);
    }

    const resolvedItems = await this.resolveItemStock(data.items);
    const shortages = resolvedItems.filter(
      (item) => item.stockManaged && item.availableStock < item.quantity,
    );

    if (shortages.length) {
      const userId = Number(data.user_id);
      if (Number.isInteger(userId) && userId > 0) {
        for (const shortage of shortages) {
          if (shortage.productColourId != null && shortage.sizeId != null) {
            await stockNotificationService.recordRequest(
              userId,
              shortage.productId,
              shortage.productColourId,
              shortage.sizeId,
            );
          }
        }
      }

      throw new InsufficientStockError(
        shortages.map((item) => ({
          name: item.name,
          color: item.color,
          size: item.size,
          requested: item.quantity,
          available: item.availableStock,
        })),
      );
    }

    // Step 1: Create order + items + billing info, and reserve stock for
    // every stock-managed item — all inside one transaction so a lost race
    // against a concurrent order rolls the whole order back too.
    const clientReference = this.generateReference();
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.orders.create({
        data: {
          user_id: Number(data.user_id) ?? null,
          total_amount: parseFloat(data.total_amount.toString()),
          reference: clientReference,
          items: { create: this.buildItems(data.items, resolvedItems) },
          billing_details: { create: this.buildBilling(data.billing) },
        },
        include: { items: true, billing_details: true },
      });

      for (const item of resolvedItems) {
        if (!item.stockManaged) continue;
        if (item.productColourId == null || item.sizeId == null) {
          throw new InsufficientStockError([
            {
              name: item.name,
              color: item.color,
              size: item.size,
              requested: item.quantity,
              available: 0,
            },
          ]);
        }
        const decremented = await tx.product_stock.updateMany({
          where: {
            product_colour_id: item.productColourId,
            size_id: item.sizeId,
            stock: { gte: item.quantity },
          },
          data: { stock: { decrement: item.quantity } },
        });
        if (decremented.count === 0) {
          throw new InsufficientStockError([
            {
              name: item.name,
              color: item.color,
              size: item.size,
              requested: item.quantity,
              available: 0,
            },
          ]);
        }
      }

      return created;
    });

    if (!order) throw new Error("Order creation failed");

    const orderNumber = this.generateOrderNumber(order.id);

    if (data.payment_type === "paystack") {
      const response = await this.verifyPayment(clientReference);
      const status =
        response.status === 200 && response.data.data.status === "success"
          ? "success"
          : "failed";

      return this.updateOrderPayment(order.id, status, orderNumber);
    } else {
      const updated_order = await this.updateOrderPayment(
        order.id,
        "pending",
        orderNumber,
      );
      const hubtelResponse = await this.initializeHubtelTransaction(
        order,
        data.return_url,
        data.cancellation_url,
      );

      return {
        message: "Hubtel payment initiated",
        checkoutUrl: hubtelResponse.checkoutUrl,
        checkoutDirectUrl: hubtelResponse.checkoutDirectUrl,
        clientReference: hubtelResponse.clientReference,
        checkoutId: hubtelResponse.checkoutId,
        updated_order,
      };
    }
  }

  async retryHubtelPayment(
    orderToken: string | null | undefined,
    return_url: string | null,
    cancellation_url: string | null,
  ) {
    if (!orderToken?.trim()) {
      throw new Error("order_token is required");
    }

    const order = await this.findOrderByRetryToken(orderToken);
    if (!order) {
      throw new Error("Order not found");
    }

    if (order.payment_status === "success") {
      throw new Error("Paid order cannot be reinitiated");
    }

    return this.reinitiatePayment(order.id, return_url, cancellation_url);
  }

  async reinitiatePayment(
    id: number,
    return_url: string | null,
    cancellation_url: string | null,
  ) {
    this.validateHubtelRedirectUrls(return_url, cancellation_url);
    const clientReference = this.generateReference();

    const order = await prisma.orders.findUnique({
      where: { id },
      include: {
        billing_details: true,
        items: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.payment_status === "success") {
      throw new Error("Paid order cannot be reinitiated");
    }

    const updated_order = await prisma.orders.update({
      where: {
        id,
      },
      data: {
        reference: clientReference,
        payment_status: "pending",
      },
      include: {
        billing_details: true,
        items: true,
      },
    });

    const hubtelResponse = await this.initializeHubtelTransaction(
      updated_order,
      return_url,
      cancellation_url,
    );

    return {
      message: "Hubtel payment initiated",
      checkoutUrl: hubtelResponse.checkoutUrl,
      checkoutDirectUrl: hubtelResponse.checkoutDirectUrl,
      clientReference: hubtelResponse.clientReference,
      checkoutId: hubtelResponse.checkoutId,
      updated_order,
    };
  }

  async findAll() {
    const orders = await prisma.orders.findMany({
      orderBy: {
        id: "desc",
      },
      include: {
        items: {
          include: {
            product: true,
            market: true,
          },
        },
        billing_details: true,
      },
    });

    return await this.flattenOrders(orders);
  }

  async findOne(id: number) {
    const order = await prisma.orders.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) throw new Error("Order not found");
    return order;
  }

  async findByUserId(userId: number) {
    const orders = prisma.orders.findMany({
      orderBy: {
        id: "desc",
      },
      where: { user_id: userId },
      include: {
        items: {
          include: { product: true, market: true },
        },
        billing_details: true,
      },
    });
    return await this.flattenOrders(await orders);
  }

  async findOneByMarketplaceId(marketplaceId: number) {
    try {
      await this.reconcilePendingHubtelPaymentsByMarket(marketplaceId, 20);
    } catch (error: any) {
      console.error(
        "Market-level Hubtel reconciliation failed:",
        error.message || error,
      );
    }

    const orders = await prisma.orders.findMany({
      orderBy: {
        id: "desc",
      },
      where: {
        items: {
          some: {
            market_id: marketplaceId,
          },
        },
      },
      include: {
        items: {
          where: { market_id: marketplaceId },
          include: { product: true, market: true },
        },
        billing_details: true,
      },
    });

    const flattenedOrders = await this.flattenOrders(orders);
    return this.deduplicateByOrderId(flattenedOrders);
  }

  async updateOrderStatusByHubtel(
    clientReference: string,
    status: "success" | "failed" | "pending",
  ) {
    const order = await prisma.orders.findFirst({
      where: { reference: clientReference },
      select: { id: true, order_number: true, payment_status: true },
    });

    if (!order) throw new Error("Order not found");
    if (order.payment_status === status) {
      return {
        message: `Payment status already ${order.payment_status}`,
        order,
      };
    }
    if (order.payment_status === "success") {
      return {
        message: `Payment status updated to ${order?.payment_status}`,
        order,
      };
    }

    const updatedOrder = await this.updateOrderPayment(
      order.id,
      status,
      order.order_number || undefined,
    );

    return {
      message: `Payment status updated to ${status}`,
      order: updatedOrder,
    };
  }

  private async verifyPayment(reference: string) {
    return axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
  }

  async verifyPaymentStatus(order_number: string) {
    const order = await prisma.orders.findFirst({
      where: { order_number },
      select: { reference: true, id: true, payment_status: true },
    });

    if (!order) return { message: "Order not found", order: null };
    if (!order.reference)
      return { message: "No payment reference found", order: null };
    if (order.payment_status === "success")
      return { message: "Payment already verified", order: null };

    const response = await this.verifyPayment(order.reference);
    const status =
      response.data.data.status === "success" ? "success" : "failed";

    const updatedOrder = await this.updateOrderPayment(
      order.id,
      status,
      order_number,
    );

    return {
      message: `Payment verification ${status}`,
      order: updatedOrder,
    };
  }

  private async restockOrderItems(orderId: number) {
    const items = await prisma.order_items.findMany({
      where: {
        order_id: orderId,
        product_colour_id: { not: null },
        size_id: { not: null },
      },
    });

    for (const item of items) {
      const colourId = item.product_colour_id!;
      const sizeId = item.size_id!;

      const before = await prisma.product_stock.findUnique({
        where: { size_id_product_colour_id: { size_id: sizeId, product_colour_id: colourId } },
      });
      const beforeStock = before?.stock ?? 0;

      await prisma.product_stock.update({
        where: { size_id_product_colour_id: { size_id: sizeId, product_colour_id: colourId } },
        data: { stock: { increment: item.quantity } },
      });

      const afterStock = beforeStock + item.quantity;
      if (beforeStock <= 0 && afterStock > 0) {
        await stockNotificationService.notifyBackInStock(colourId, sizeId);
      }
    }
  }

  private async updateOrderPayment(
    orderId: number,
    status: "success" | "failed" | "pending",
    orderNumber?: string,
  ) {
    const previous = await prisma.orders.findUnique({
      where: { id: orderId },
      select: { payment_status: true },
    });

    const updatedOrder = await prisma.orders.update({
      where: { id: orderId },
      data: { payment_status: status, order_number: orderNumber },
      include: { items: true, billing_details: true },
    });

    if (status === "failed" && previous?.payment_status !== "failed") {
      await this.restockOrderItems(orderId);
    }

    const recipientUserId = Number(updatedOrder.user_id);
    if (
      Number.isInteger(recipientUserId) &&
      recipientUserId > 0 &&
      (status === "success" || status === "failed")
    ) {
      await notificationService.createInAppNotification({
        type: status === "success" ? "order.payment_success" : "order.payment_failed",
        title: status === "success" ? "Payment successful" : "Payment failed",
        body:
          status === "success"
            ? `Payment for order ${updatedOrder.order_number || `#${updatedOrder.id}`} was successful.`
            : `Payment for order ${updatedOrder.order_number || `#${updatedOrder.id}`} failed.`,
        recipientUserId,
        actorUserId: null,
        entityType: "ORDER",
        entityId: String(updatedOrder.id),
        actionUrl: "/member/market/orders",
        priority: status === "success" ? "MEDIUM" : "HIGH",
        dedupeKey: `order:${updatedOrder.id}:payment:${status}`,
        sendSms: true,
        smsBody:
          status === "success"
            ? `Payment successful for order ${updatedOrder.order_number || `#${updatedOrder.id}`}.`
            : `Payment failed for order ${updatedOrder.order_number || `#${updatedOrder.id}`}. Open the app for details.`,
      });
    }

    return updatedOrder;
  }

  async updateDeliveryStatus(
    orderId: number,
    status: "pending" | "shipped" | "delivered" | "cancelled",
    actorUserId?: number | null,
  ) {
    const normalizedStatus = status.trim().toLowerCase();
    if (!["pending", "shipped", "delivered", "cancelled"].includes(normalizedStatus)) {
      throw new Error("delivery status must be pending, shipped, delivered, or cancelled");
    }

    const updatedOrder = await prisma.orders.update({
      where: {
        id: orderId,
      },
      data: {
        delivery_status: normalizedStatus as any,
      },
      include: {
        items: true,
        billing_details: true,
      },
    });

    const recipientUserId = Number(updatedOrder.user_id);
    if (Number.isInteger(recipientUserId) && recipientUserId > 0) {
      await notificationService.createInAppNotification({
        type: "delivery.status_changed",
        title: "Delivery status updated",
        body: `Delivery status for order ${updatedOrder.order_number || `#${updatedOrder.id}`} is now ${normalizedStatus}.`,
        recipientUserId,
        actorUserId:
          Number.isInteger(Number(actorUserId)) && Number(actorUserId) > 0
            ? Number(actorUserId)
            : null,
        entityType: "ORDER",
        entityId: String(updatedOrder.id),
        actionUrl: "/member/market/orders",
        priority: "MEDIUM",
        dedupeKey: `order:${updatedOrder.id}:delivery:${normalizedStatus}`,
        sendSms: true,
        smsBody: `Delivery status for order ${updatedOrder.order_number || `#${updatedOrder.id}`} is now ${normalizedStatus}.`,
      });
    }

    return updatedOrder;
  }

  async initializeHubtelTransaction(
    order: any,
    return_url: string | null,
    cancellation_url: string | null,
  ) {
    console.log("initializing hubtel transaction");
    const url =
      process.env.HUBTEL_INIT_PAYMENT_URL ||
      "https://payproxyapi.hubtel.com/items/initiate";

    const payload = {
      totalAmount: order.total_amount,
      description: `Payment for WWM Order`,
      callbackUrl: process.env.HUBTEL_CALLBACK_URL,
      returnUrl: `${return_url}?order_reference=${order.reference}`,
      cancellationUrl: cancellation_url,
      merchantAccountNumber: process.env.HUBTEL_POS_ID,
      clientReference: order.reference,
      payeeName: `${order.billing_details.first_name} ${order.billing_details.last_name}`,
      payeeMobileNumber: order.billing_details.phone_number,
      payeeEmail: order.billing_details.email,
    };
    console.log(payload);

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${process.env.HUBTEL_AUTH}`,
      },
    });

    console.log(response.data);
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.responseCode !== "0000") {
      throw new Error(`Hubtel init failed: ${response.data.message}`);
    }

    return response.data.data;
  }

  async checkHubtelTransactionStatus(clientReference: string) {
    try {
      const posId = process.env.HUBTEL_POS_ID;
      if (!posId) throw new Error("HUBTEL_POS_ID is not configured");

      const url = `https://api-txnstatus.hubtel.com/transactions/${posId}/status?clientReference=${clientReference}`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Basic ${process.env.HUBTEL_AUTH}`,
          "Content-Type": "application/json",
        },
      });
      console.log(`transactional check ${response}`);
      console.log(JSON.stringify(response.data, null, 2));

      const status = response.data?.data?.status;
      if (!status) throw new Error("Invalid response from Hubtel");

      const normalizedStatus = this.normalizeHubtelStatus(status);

      return this.updateOrderStatusByHubtel(clientReference, normalizedStatus);
    } catch (error: any) {
      console.error("Hubtel status check failed:", error.message);
      throw new Error("Unable to check Hubtel transaction status");
    }
  }

  async checkHubtelTransactionStatusById(id: number) {
    const order = await prisma.orders.findUnique({
      where: { id },
      select: {
        reference: true,
        payment_status: true,
      },
    });

    if (order?.payment_status === "success") {
      return { success: true };
    } else {
      return await this.checkHubtelTransactionStatus(String(order?.reference));
    }
  }

  async reconcilePendingHubtelPayments(limit = 100) {
    const STALE_PENDING_MS = 48 * 60 * 60 * 1000;
    const now = Date.now();

    const pendingOrders = await prisma.orders.findMany({
      where: { payment_status: "pending" },
      orderBy: { id: "desc" },
      take: limit,
      select: { id: true, reference: true, payment_status: true, created_at: true },
    });

    const results = await Promise.allSettled(
      pendingOrders.map(async (order) => {
        const result = await this.checkHubtelTransactionStatus(order.reference);
        const stillPending = result?.order?.payment_status === "pending";
        const isStale = now - order.created_at.getTime() > STALE_PENDING_MS;

        if (stillPending && isStale) {
          return this.updateOrderStatusByHubtel(order.reference, "failed");
        }
        return result;
      }),
    );

    let successUpdates = 0;
    let failedUpdates = 0;
    let stillPending = 0;
    let errors = 0;

    for (const result of results) {
      if (result.status === "rejected") {
        errors += 1;
        continue;
      }

      const currentStatus = result.value?.order?.payment_status;
      if (currentStatus === "success") successUpdates += 1;
      else if (currentStatus === "failed") failedUpdates += 1;
      else stillPending += 1;
    }

    return {
      scanned: pendingOrders.length,
      success_updates: successUpdates,
      failed_updates: failedUpdates,
      still_pending: stillPending,
      errors,
    };
  }

  private async resolveItemStock(
    items: { id: string | number; name: string; color: string; size: string; quantity: number }[],
  ): Promise<ResolvedOrderItem[]> {
    const invalidItem = items.find((item) => !Number.isInteger(Number(item.id)));
    if (invalidItem) {
      throw new Error(`Invalid product id "${invalidItem.id}" for item "${invalidItem.name}"`);
    }

    const productIds = [...new Set(items.map((item) => Number(item.id)))];

    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock_managed: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const colours = await prisma.product_colour.findMany({
      where: { product_id: { in: productIds } },
      select: { id: true, colour: true, product_id: true },
    });
    const colourIdByProductAndName = new Map(
      colours.map((c) => [`${c.product_id}:${c.colour}`, c.id]),
    );

    const sizeNames = [...new Set(items.map((item) => item.size))];
    const sizes = await prisma.sizes.findMany({
      where: { name: { in: sizeNames } },
      select: { id: true, name: true },
    });
    const sizeIdByName = new Map(sizes.map((s) => [s.name, s.id]));

    const stockRows = await prisma.product_stock.findMany({
      where: {
        product_colour_id: { in: colours.map((c) => c.id) },
        size_id: { in: sizes.map((s) => s.id) },
      },
    });
    const stockByColourAndSize = new Map(
      stockRows.map((row) => [`${row.product_colour_id}:${row.size_id}`, row.stock]),
    );

    return items.map((item) => {
      const productId = Number(item.id);
      const product = productById.get(productId);
      const stockManaged = product?.stock_managed === "yes";
      const quantity = Number(item.quantity);

      if (!stockManaged) {
        return {
          productId,
          color: item.color,
          size: item.size,
          name: item.name,
          quantity,
          stockManaged,
          productColourId: null,
          sizeId: null,
          availableStock: Infinity,
        };
      }

      const productColourId = colourIdByProductAndName.get(`${productId}:${item.color}`) ?? null;
      const sizeId = sizeIdByName.get(item.size) ?? null;
      const availableStock =
        productColourId != null && sizeId != null
          ? stockByColourAndSize.get(`${productColourId}:${sizeId}`) ?? 0
          : 0;

      return {
        productId,
        color: item.color,
        size: item.size,
        name: item.name,
        quantity,
        stockManaged,
        productColourId,
        sizeId,
        availableStock,
      };
    });
  }

  private buildItems(items: any[], resolved: ResolvedOrderItem[]) {
    return items.map((item, index) => {
      const match = resolved[index];
      return {
        name: item.name,
        product_id: Number(item.id),
        price_amount: item.price_amount,
        market_id: Number(item.market_id),
        price_currency: item.price_currency,
        quantity: item.quantity,
        product_type: item.product_type,
        product_category: item.product_category,
        image_url: item.image_url,
        color: item.color,
        size: item.size,
        product_colour_id: match?.stockManaged ? match.productColourId ?? undefined : undefined,
        size_id: match?.stockManaged ? match.sizeId ?? undefined : undefined,
      };
    });
  }

  private buildBilling(billing: any) {
    return {
      first_name: toSentenceCase(billing.first_name),
      last_name: toSentenceCase(billing.last_name),
      email: billing.email,
      phone_number: billing.phone_number,
      country: billing.country,
      country_code: billing.country_code,
    };
  }

  private generateOrderNumber(orderId: number): string {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const paddedId = String(orderId).padStart(6, "0");

    return `#WWM-${yyyy}${mm}${dd}-${paddedId}`;
  }

  private generateReference(): string {
    const client_reference = crypto.randomUUID();
    return client_reference.toString();
  }

  private validateHubtelRedirectUrls(
    return_url: string | null,
    cancellation_url: string | null,
  ) {
    if (!return_url || !cancellation_url) {
      throw new Error(
        "return_url and cancellation_url are required for Hubtel payments",
      );
    }
  }

  private async findOrderByRetryToken(token: string) {
    const cleanedToken = token.trim();

    if (/^\d+$/.test(cleanedToken)) {
      const orderById = await prisma.orders.findUnique({
        where: { id: Number(cleanedToken) },
        include: { items: true, billing_details: true },
      });
      if (orderById) return orderById;
    }

    return prisma.orders.findFirst({
      where: {
        OR: [{ reference: cleanedToken }, { order_number: cleanedToken }],
      },
      include: { items: true, billing_details: true },
    });
  }

  private normalizeHubtelStatus(
    status: string,
  ): "success" | "failed" | "pending" {
    const normalizedStatus = status.trim().toLowerCase();

    if (
      ["paid", "success", "successful", "completed", "complete"].includes(
        normalizedStatus,
      )
    ) {
      return "success";
    }

    if (
      ["failed", "failure", "cancelled", "canceled", "expired", "declined"].includes(
        normalizedStatus,
      )
    ) {
      return "failed";
    }

    return "pending";
  }

  private async reconcilePendingHubtelPaymentsByMarket(
    marketplaceId: number,
    limit: number,
  ) {
    const pendingOrders = await prisma.orders.findMany({
      where: {
        payment_status: "pending",
        items: {
          some: {
            market_id: marketplaceId,
          },
        },
      },
      orderBy: { id: "desc" },
      take: limit,
      select: { reference: true },
    });

    await Promise.allSettled(
      pendingOrders.map((order) =>
        this.checkHubtelTransactionStatus(order.reference),
      ),
    );
  }

  private async flattenOrders(orders: any[]) {
    return orders.flatMap((order) => {
      const billingDetails = order.billing_details;

      return (
        order.items
          // .filter((item: any) => {
          //   const market = item.market;

          //   console.log("Filtering item:", item.id);
          //   console.log("market:", market);

          //   // Remove items without a market
          //   if (!market) return false;

          //   // Remove deleted markets
          //   if (market.deleted === true) return false;

          //   // Remove markets without end_date
          //   if (!market.end_date) return true;

          //   // Remove ended markets
          //   const endDate = new Date(market.end_date);
          //   const now = new Date();

          //   return endDate > now;
          // })
          .map((item: any) => {
            const marketEndDate = item.market?.end_date
              ? new Date(item.market.end_date)
              : null;
            const hasValidEndDate =
              marketEndDate !== null && !Number.isNaN(marketEndDate.getTime());
            const marketStatus =
              !hasValidEndDate || marketEndDate > new Date()
                ? "Active"
                : "Ended";

            return {
              id: item.id,
              order_id: item.order_id,
              name: item.name,
              market_id: item.market_id,
              market_name: item.market?.name,
              market_status: marketStatus,
              product_id: item.product_id,
              price_amount: item.price_amount,
              price_currency: item.price_currency,
              quantity: item.quantity,
              product_type: item.product_type,
              product_category: item.product_category,
              image_url: item.image_url,
              color: item.color,
              size: item.size,

              // Order fields
              order_number: order.order_number,
              payment_status: order.payment_status,
              reference: order.reference,
              created_at: order.created_at,

              // Flattened product fields
              product_name: item.product?.name,
              product_description: item.product?.description,
              product_colours: item.product?.colours,
              product_status: item.product?.status,
              product_price_amount: item.product?.price_amount,
              product_price_currency: item.product?.price_currency,
              product_market_id: item.product?.market_id,

              // Flattened billing details
              first_name: billingDetails?.first_name,
              last_name: billingDetails?.last_name,
              email: billingDetails?.email,
              phone_number: billingDetails?.phone_number,
              country: billingDetails?.country,
              country_code: billingDetails?.country_code,

              // Computed field
              total_amount: item.price_amount * item.quantity,
            };
          })
      );
    });
  }

  private deduplicateByOrderId(orders: any[]) {
    const uniqueOrdersById = new Map<number, any>();

    for (const order of orders) {
      if (!uniqueOrdersById.has(order.order_id)) {
        uniqueOrdersById.set(order.order_id, order);
      }
    }

    return Array.from(uniqueOrdersById.values());
  }
}
