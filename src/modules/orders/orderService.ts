import { prisma } from "../../Models/context";
import { Prisma } from "@prisma/client";
import axios from "axios";
import crypto from "crypto";
import { toSentenceCase } from "../../utils";
import { notificationService } from "../notifications/notificationService";
import { stockNotificationService } from "../products/stockNotificationService";
import {
  initializeTransaction,
  verifyTransaction,
} from "../../libs/paystack/paystackTransaction";
import {
  bulkTransitionSkipReason,
  computeItemsSubtotal,
  computeOrderTotal,
  getMarketplaceDeliveryConfig,
  resolveFulfilment,
  resolveDbUnitPrice,
  roundMoney,
  toDateKey,
  type DeliveryStatusValue,
  type PaymentStatusValue,
  type ResolvedFulfilment,
} from "./marketplaceFulfilment";

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

/** The order changed between read and write (concurrent update) — 409. */
export class OrderConflictError extends Error {
  constructor(message = "This order was changed by someone else while you were updating it. Refresh and try again") {
    super(message);
    this.name = "OrderConflictError";
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
  /** Authoritative unit price from products.price_amount (never the client's). */
  unitPrice: number;
  /** products.price_currency, or the client's value when the product has none. */
  priceCurrency: string;
  /** products.market_id — fallback when the client omits market_id. */
  marketId: number | null;
};

export type OrderItemEdit = {
  /** order_items.id of the line being changed. */
  id: number;
  quantity: number;
  color: string;
  size: string;
  price_amount: number;
  /** true = delete this line entirely (stock, if managed, is restocked in full). */
  removed?: boolean;
};

export type UpdateOrderInput = {
  id: number;
  billing?: Partial<{
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    country: string;
    country_code: string;
  }>;
  payment_status?: "pending" | "success" | "failed";
  delivery_status?: "pending" | "shipped" | "delivered" | "cancelled";
  items?: OrderItemEdit[];
};

export type CreateOrderForMemberInput = {
  user_id: number;
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
    id?: number | string;
    product_id?: number | string;
    name: string;
    price_amount: number;
    price_currency: string;
    quantity: number;
    product_type: string;
    product_category: string;
    image_url: string;
    color: string;
    size: string;
  }[];
  payment_mode: "manual" | "gateway";
  /** Only used when payment_mode is "manual". Defaults to "success". */
  manual_status?: "success" | "pending";
  /** Only used when payment_mode is "gateway". */
  payment_type?: "paystack" | "hubtel";
  return_url?: string | null;
  cancellation_url?: string | null;
  placed_by_staff_id: number;
  /** "pickup" (default) | "delivery". */
  fulfilment_method?: string | null;
  /** Required when fulfilment_method is "delivery". */
  delivery_address?: string | null;
};

export class OrderService {
  async findOrderByName(first_name?: string, last_name?: string) {
    const orders = await prisma.orders.findMany({
      where: {
        deleted_at: null,
        billing_details: {
          is: {
            ...(first_name ? { first_name: { contains: first_name } } : {}),
            ...(last_name ? { last_name: { contains: last_name } } : {}),
          },
        },
      },
      include: {
        items: {
          include: { product: true, market: true, product_colour: true },
        },
        billing_details: true,
      },
    });
    return this.flattenOrders(orders);
  }
  // Create a new order
  async create(
    data: {
    user_id?: number | null | string;
    /** Client-computed total. Informational only — the stored/charged total is
     * recomputed server-side from items + delivery fee (see below). */
    total_amount?: number | string | null;
    payment_type: "paystack" | "hubtel" | null;
    /** "pickup" (default — old clients omit it) | "delivery". */
    fulfilment_method?: string | null;
    /** Required when fulfilment_method is "delivery". */
    delivery_address?: string | null;
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
      // Web checkout sends `product_id`; mobile sends `id` (falling back to
      // `product_id`). Accept either — see resolveItemStock/buildItems.
      id?: number | string;
      product_id?: number | string;
      price_amount: number;
      price_currency: string;
      quantity: number;
      product_type: string;
      product_category: string;
      image_url: string;
      color: string;
      size: string;
    }[];
    },
    options: { reuseExistingPending?: boolean } = {},
  ) {
    if (data.payment_type === "hubtel") {
      this.validateHubtelRedirectUrls(data.return_url, data.cancellation_url);
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("At least one item is required");
    }
    for (const item of data.items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Quantity for "${item.name}" must be a positive integer`);
      }
    }

    // Fulfilment: pickup (default) or delivery. The fee always comes from
    // server config, never from the client.
    const fulfilment = resolveFulfilment(data, getMarketplaceDeliveryConfig());

    // Resolves stock AND the authoritative unit price from the products
    // table (client price_amount is ignored). Rejects missing/deleted/
    // unpriced products. Shortages are checked further down, after the
    // pending-order reuse check (a reused order already holds its stock).
    const resolvedItems = await this.resolveItemStock(data.items);

    // Authoritative total = DB-priced item subtotal + delivery fee, so the
    // fee is counted exactly once whatever the client put in total_amount.
    const pricedItems = this.toPricedItems(resolvedItems);
    const totalAmount = computeOrderTotal(pricedItems, fulfilment.delivery_fee);
    const clientTotal =
      data.total_amount != null && String(data.total_amount).trim() !== ""
        ? Number(data.total_amount)
        : NaN;
    if (Number.isFinite(clientTotal) && roundMoney(clientTotal) !== totalAmount) {
      console.warn(
        `create-order: client total_amount ${clientTotal} differs from server total ${totalAmount} (items ${computeItemsSubtotal(pricedItems)} + fee ${fulfilment.delivery_fee}); using server total`,
      );
    }

    // Idempotency guard: retrying a failed/abandoned checkout (network
    // error, gateway init failure, closed tab) previously created a brand
    // new order + re-reserved stock every single time, since nothing
    // checked for an already-open attempt first. Reuse an existing pending
    // order for the identical cart instead of stacking duplicates. Guest
    // checkouts (no reliable user_id) aren't deduped — no stable identity
    // to match against.
    const existingPending =
      options.reuseExistingPending !== false
        ? await this.findMatchingPendingOrder(data, fulfilment)
        : null;
    if (existingPending) {
      return this.reuseExistingPendingOrder(existingPending, data);
    }

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
          // `Number(data.user_id) ?? null` was wrong for guests: Number(undefined)
          // is NaN, and NaN is not nullish, so `?? null` never caught it — Prisma
          // would reject the NaN for this Int? column. Guard explicitly instead.
          user_id: data.user_id != null ? Number(data.user_id) : null,
          total_amount: totalAmount,
          fulfilment_method: fulfilment.fulfilment_method,
          delivery_address: fulfilment.delivery_address,
          delivery_fee: fulfilment.delivery_fee,
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
      const updated_order = await this.updateOrderPayment(
        order.id,
        "pending",
        orderNumber,
      );
      const paystackResponse = await this.initializePaystackTransaction(
        order,
        data.return_url,
      );

      return {
        message: "Paystack payment initiated",
        checkoutUrl: paystackResponse.authorization_url,
        clientReference: paystackResponse.reference,
        updated_order,
      };
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

  /**
   * Admin-initiated order on behalf of a member. "gateway" mode delegates
   * to the normal create() flow (same idempotency-dedup against an
   * existing matching pending order, same Paystack/Hubtel init) and just
   * stamps placed_by_staff_id afterward. "manual" mode skips the gateway
   * entirely — the transaction, stock-shortage check, and stock
   * reservation mirror create()'s, using the shared reserveVariant helper
   * instead of create()'s inline decrement.
   */
  async createForMember(data: CreateOrderForMemberInput) {
    if (!Number.isInteger(data.user_id) || data.user_id <= 0) {
      throw new Error("A valid member user_id is required");
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("At least one item is required");
    }
    for (const item of data.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error(
          `Quantity for "${item.name}" must be a positive integer`,
        );
      }
    }
    if (data.payment_mode !== "manual" && data.payment_mode !== "gateway") {
      throw new Error('payment_mode must be "manual" or "gateway"');
    }

    // Deliberately no member notification here (unlike updateOrderPayment/
    // updateDeliveryStatus/cancelOrder) — a manually-placed order implies
    // staff already spoke to the member out-of-band. Revisit if that
    // assumption turns out wrong.
    // Validated up-front for both modes (create() re-resolves it for gateway).
    const fulfilment = resolveFulfilment(data, getMarketplaceDeliveryConfig());

    if (data.payment_mode === "gateway") {
      const created = await this.create(
        {
          user_id: data.user_id,
          // create() recomputes the total from items + delivery fee.
          total_amount: null,
          payment_type: data.payment_type ?? "paystack",
          return_url: data.return_url ?? null,
          cancellation_url: data.cancellation_url ?? null,
          billing: data.billing,
          items: data.items,
          fulfilment_method: fulfilment.fulfilment_method,
          delivery_address: fulfilment.delivery_address,
        },
        { reuseExistingPending: false },
      );
      const stampedOrder = await prisma.orders.update({
        where: { id: created.updated_order.id },
        data: { placed_by_staff_id: data.placed_by_staff_id },
        include: { items: true, billing_details: true },
      });
      return { ...created, updated_order: stampedOrder };
    }

    const resolvedItems = await this.resolveItemStock(data.items);
    const shortages = resolvedItems.filter(
      (item) => item.stockManaged && item.availableStock < item.quantity,
    );
    if (shortages.length) {
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

    // DB prices (resolveItemStock), not the client's price_amount.
    const total_amount = computeOrderTotal(
      this.toPricedItems(resolvedItems),
      fulfilment.delivery_fee,
    );
    // Prefixed so the Hubtel reconciliation sweeps (which force-fail and
    // restock any pending order older than 48h) can recognize and skip
    // this — there's no real Hubtel transaction behind a manual order, so
    // "Hubtel doesn't recognize this reference" would otherwise look
    // identical to a genuinely abandoned gateway checkout.
    const clientReference = `MANUAL-${this.generateReference()}`;
    const manualStatus = data.manual_status ?? "success";
    if (manualStatus !== "success" && manualStatus !== "pending") {
      throw new Error('manual_status must be "success" or "pending"');
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.orders.create({
        data: {
          user_id: data.user_id,
          total_amount,
          reference: clientReference,
          payment_status: manualStatus,
          placed_by_staff_id: data.placed_by_staff_id,
          fulfilment_method: fulfilment.fulfilment_method,
          delivery_address: fulfilment.delivery_address,
          delivery_fee: fulfilment.delivery_fee,
          items: { create: this.buildItems(data.items, resolvedItems) },
          billing_details: { create: this.buildBilling(data.billing) },
        },
        include: { items: true, billing_details: true },
      });

      for (const item of resolvedItems) {
        if (!item.stockManaged) continue;
        await this.reserveVariant(
          tx,
          item.productColourId!,
          item.sizeId!,
          item.quantity,
          item.name,
          item.color,
          item.size,
        );
      }

      return created;
    });

    const orderNumber = this.generateOrderNumber(order.id);
    return prisma.orders.update({
      where: { id: order.id },
      data: { order_number: orderNumber },
      include: { items: true, billing_details: true },
    });
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

    const order = await prisma.orders.findFirst({
      where: { id, deleted_at: null },
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
      where: { deleted_at: null },
      orderBy: {
        id: "desc",
      },
      include: {
        items: {
          include: {
            // `product: { include: { product_colours: true } }` (not bare
            // `product: true`) — flattenOrders needs the product's full
            // colour catalog to recover a name for old order_items that
            // predate `product_colour_id` (matched by hex against `color`).
            product: { include: { product_colours: true } },
            market: true,
            product_colour: true,
          },
        },
        billing_details: true,
      },
    });

    return await this.flattenOrders(orders);
  }

  async findOne(id: number) {
    const order = await prisma.orders.findFirst({
      where: { id, deleted_at: null },
      include: {
        items: { include: { product_colour: true } },
        billing_details: true,
      },
    });

    if (!order) throw new Error("Order not found");
    return order;
  }

  async updateOrder(data: UpdateOrderInput) {
    const order = await prisma.orders.findFirst({
      where: { id: data.id, deleted_at: null },
      include: { items: true, billing_details: true },
    });
    if (!order) throw new Error("Order not found");

    const editingItems = Array.isArray(data.items) && data.items.length > 0;
    if (
      editingItems &&
      (["delivered", "cancelled"].includes(order.delivery_status) ||
        order.payment_status === "failed")
    ) {
      throw new Error(
        "Cannot edit items once delivery is delivered/cancelled or payment has failed",
      );
    }

    if (
      order.delivery_status === "cancelled" &&
      data.delivery_status &&
      data.delivery_status !== "cancelled"
    ) {
      throw new Error(
        "Cannot move a cancelled order back to an active delivery status",
      );
    }

    if (
      order.payment_status === "failed" &&
      data.payment_status &&
      data.payment_status !== "failed"
    ) {
      throw new Error(
        "Cannot move a failed order back to pending or success — its stock has already been released",
      );
    }

    if (order.delivery_status === "delivered" && data.delivery_status === "cancelled") {
      throw new Error("Cannot cancel an order that has already been delivered");
    }

    let restockedVariants: { productColourId: number; sizeId: number }[] = [];
    const changingStatus = Boolean(data.payment_status || data.delivery_status);

    await prisma.$transaction(async (tx) => {
      // Optimistic claim: every guard above and the restock decision below
      // were made from `order` as read OUTSIDE this transaction. Re-assert
      // that exact payment/delivery state while writing the new statuses —
      // if a concurrent cancel/fail/webhook moved it in between, count is 0
      // and we abort instead of double-restocking. The UPDATE also holds the
      // row lock for the rest of this transaction.
      if (changingStatus || editingItems) {
        const claim = await tx.orders.updateMany({
          where: {
            id: order.id,
            deleted_at: null,
            payment_status: order.payment_status,
            delivery_status: order.delivery_status,
          },
          data: changingStatus
            ? {
                ...(data.payment_status && { payment_status: data.payment_status }),
                ...(data.delivery_status && { delivery_status: data.delivery_status }),
              }
            : { updated_at: new Date() },
        });
        if (claim.count === 0) throw new OrderConflictError();
      }

      if (editingItems) {
        restockedVariants = await this.applyItemEdits(tx, order.items, data.items!);

        const remainingItems = await tx.order_items.findMany({
          where: { order_id: order.id },
          select: { price_amount: true, quantity: true },
        });

        if (remainingItems.length === 0) {
          throw new Error(
            "Cannot remove every item from an order — cancel or delete the order instead",
          );
        }

        // Keep the delivery fee in the stored total when items change.
        const newTotal = computeOrderTotal(remainingItems, order.delivery_fee ?? 0);
        await tx.orders.update({
          where: { id: order.id },
          data: { total_amount: newTotal },
        });
      }

      if (data.billing) {
        await tx.billing_details.update({
          where: { order_id: order.id },
          data: {
            ...(data.billing.first_name && {
              first_name: toSentenceCase(data.billing.first_name),
            }),
            ...(data.billing.last_name && {
              last_name: toSentenceCase(data.billing.last_name),
            }),
            ...(data.billing.email && { email: data.billing.email }),
            ...(data.billing.phone_number && {
              phone_number: data.billing.phone_number,
            }),
            ...(data.billing.country && { country: data.billing.country }),
            ...(data.billing.country_code && {
              country_code: data.billing.country_code,
            }),
          },
        });
      }

      const movingToCancelled =
        data.delivery_status === "cancelled" && order.delivery_status !== "cancelled";
      const movingToFailed =
        data.payment_status === "failed" && order.payment_status !== "failed";
      // Stock was already released via the OTHER status field — don't
      // restock a second time. Safe to decide from `order` because the claim
      // above proved that state was still current when we wrote.
      const stockAlreadyReleased =
        order.payment_status === "failed" || order.delivery_status === "cancelled";

      if ((movingToCancelled || movingToFailed) && !stockAlreadyReleased) {
        const additionallyRestocked = await this.restockAllItems(tx, order.id);
        restockedVariants.push(...additionallyRestocked);
      }
    });

    // Fire back-in-stock notifications only after the transaction has
    // actually committed — restockVariant deliberately doesn't do this
    // itself (see its docstring).
    for (const variant of restockedVariants) {
      await stockNotificationService.notifyBackInStock(
        variant.productColourId,
        variant.sizeId,
      );
    }

    const refreshed = await prisma.orders.findFirst({
      where: { id: order.id },
      include: { items: true, billing_details: true },
    });
    if (!refreshed) throw new Error("Order not found after update");
    return refreshed;
  }

  /**
   * Applies per-line edits inside the caller's transaction: qty deltas
   * reserve/restock the difference, a color/size change restocks the old
   * variant in full and reserves the new one, `removed` restocks in full
   * and deletes the line. Only stock-managed lines (product_colour_id +
   * size_id both set) touch product_stock at all. Returns the variants
   * that crossed from 0 to positive stock, for the caller to notify about
   * once its transaction commits.
   */
  private async applyItemEdits(
    tx: Prisma.TransactionClient,
    existingItems: { id: number; product_id: number | null; product_colour_id: number | null; size_id: number | null; color: string; size: string; quantity: number; name: string }[],
    edits: OrderItemEdit[],
  ): Promise<{ productColourId: number; sizeId: number }[]> {
    const seenIds = new Set<number>();
    for (const edit of edits) {
      if (seenIds.has(edit.id)) {
        throw new Error(`Duplicate edit for order item ${edit.id}`);
      }
      seenIds.add(edit.id);

      if (!edit.removed) {
        if (!Number.isInteger(edit.quantity) || edit.quantity <= 0) {
          throw new Error(
            `Quantity for order item ${edit.id} must be a positive integer`,
          );
        }
        if (typeof edit.price_amount !== "number" || edit.price_amount < 0) {
          throw new Error(
            `Price for order item ${edit.id} must be zero or greater`,
          );
        }
      }
    }

    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const restockedVariants: { productColourId: number; sizeId: number }[] = [];

    for (const edit of edits) {
      const existing = existingById.get(edit.id);
      if (!existing) {
        throw new Error(`Order item ${edit.id} does not belong to this order`);
      }

      const stockManaged =
        existing.product_colour_id != null && existing.size_id != null;
      const variantChanged =
        existing.color !== edit.color || existing.size !== edit.size;

      if (edit.removed) {
        if (stockManaged) {
          const crossed = await this.restockVariant(
            tx,
            existing.product_colour_id!,
            existing.size_id!,
            existing.quantity,
          );
          if (crossed) {
            restockedVariants.push({
              productColourId: existing.product_colour_id!,
              sizeId: existing.size_id!,
            });
          }
        }
        await tx.order_items.delete({ where: { id: edit.id } });
        continue;
      }

      if (stockManaged && variantChanged) {
        if (existing.product_id == null) {
          throw new Error(
            `Order item ${edit.id} has no associated product; cannot change variant`,
          );
        }
        const resolved = await this.resolveSingleVariant(
          tx,
          existing.product_id,
          edit.color,
          edit.size,
        );
        const crossed = await this.restockVariant(
          tx,
          existing.product_colour_id!,
          existing.size_id!,
          existing.quantity,
        );
        if (crossed) {
          restockedVariants.push({
            productColourId: existing.product_colour_id!,
            sizeId: existing.size_id!,
          });
        }
        await this.reserveVariant(
          tx,
          resolved.productColourId,
          resolved.sizeId,
          edit.quantity,
          existing.name,
          edit.color,
          edit.size,
        );
        await tx.order_items.update({
          where: { id: edit.id },
          data: {
            color: edit.color,
            size: edit.size,
            quantity: edit.quantity,
            price_amount: edit.price_amount,
            product_colour_id: resolved.productColourId,
            size_id: resolved.sizeId,
          },
        });
        continue;
      }

      if (stockManaged) {
        const delta = edit.quantity - existing.quantity;
        if (delta > 0) {
          await this.reserveVariant(
            tx,
            existing.product_colour_id!,
            existing.size_id!,
            delta,
            existing.name,
            existing.color,
            existing.size,
          );
        } else if (delta < 0) {
          const crossed = await this.restockVariant(
            tx,
            existing.product_colour_id!,
            existing.size_id!,
            -delta,
          );
          if (crossed) {
            restockedVariants.push({
              productColourId: existing.product_colour_id!,
              sizeId: existing.size_id!,
            });
          }
        }
      }

      await tx.order_items.update({
        where: { id: edit.id },
        data: {
          quantity: edit.quantity,
          price_amount: edit.price_amount,
          color: edit.color,
          size: edit.size,
        },
      });
    }

    return restockedVariants;
  }

  /** Restocks every stock-managed line still on an order — used when a
   * transition into "failed"/"cancelled" needs to release everything that
   * remains reserved, mirroring what cancelOrder/updateOrderPayment do for
   * their own endpoints. Runs inside the caller's transaction. */
  private async restockAllItems(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<{ productColourId: number; sizeId: number }[]> {
    const items = await tx.order_items.findMany({
      where: {
        order_id: orderId,
        product_colour_id: { not: null },
        size_id: { not: null },
      },
    });

    const restocked: { productColourId: number; sizeId: number }[] = [];
    for (const item of items) {
      const crossed = await this.restockVariant(
        tx,
        item.product_colour_id!,
        item.size_id!,
        item.quantity,
      );
      if (crossed) {
        restocked.push({
          productColourId: item.product_colour_id!,
          sizeId: item.size_id!,
        });
      }
    }
    return restocked;
  }

  async findByUserId(userId: number) {
    const orders = prisma.orders.findMany({
      orderBy: {
        id: "desc",
      },
      where: { user_id: userId, deleted_at: null },
      include: {
        items: {
          include: { product: true, market: true, product_colour: true },
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
        deleted_at: null,
        items: {
          some: {
            market_id: marketplaceId,
          },
        },
      },
      include: {
        items: {
          where: { market_id: marketplaceId },
          include: { product: true, market: true, product_colour: true },
        },
        billing_details: true,
      },
    });

    // flattenOrders yields one row per item, by design (columns are
    // item-level: size/color/qty). Do NOT dedupe by order_id afterwards —
    // a multi-item order legitimately produces multiple rows sharing an
    // order_id; collapsing them silently drops every item but the first.
    return await this.flattenOrders(orders);
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

  async verifyPaymentStatus(order_number: string) {
    const order = await prisma.orders.findFirst({
      where: { order_number, deleted_at: null },
      select: { reference: true, id: true, payment_status: true },
    });

    if (!order) return { message: "Order not found", order: null };
    if (!order.reference)
      return { message: "No payment reference found", order: null };
    if (order.payment_status === "success")
      return { message: "Payment already verified", order: null };
    if (order.reference.startsWith("MANUAL-")) {
      // No real Paystack/Hubtel transaction behind a manually-placed
      // order — nothing to verify, and calling verifyTransaction with this
      // reference would just get a false "failed" back from Paystack,
      // force-failing (and restocking) a still-valid manual order.
      return { message: "This order was placed manually and has no payment to verify", order: null };
    }

    const transaction = await verifyTransaction(order.reference);
    const status = transaction.status === "success" ? "success" : "failed";

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

  /**
   * Returns a stock-managed product's variant ids for a given color/size
   * name pair. Used when an edit changes an existing line's color/size —
   * resolveItemStock resolves a whole cart, this resolves one variant.
   */
  private async resolveSingleVariant(
    tx: Prisma.TransactionClient,
    productId: number,
    colour: string,
    size: string,
  ): Promise<{ productColourId: number; sizeId: number }> {
    const product = await tx.products.findUnique({
      where: { id: productId },
      select: { stock_managed: true },
    });
    if (product?.stock_managed !== "yes") {
      throw new Error(`Product ${productId} is not stock-managed`);
    }

    const colourRow = await tx.product_colour.findFirst({
      where: { product_id: productId, colour },
      select: { id: true },
    });
    const sizeRow = await tx.sizes.findUnique({
      where: { name: size },
      select: { id: true },
    });

    if (!colourRow || !sizeRow) {
      throw new Error(
        `Unknown color/size combination "${colour}/${size}" for this product`,
      );
    }

    const stockRow = await tx.product_stock.findUnique({
      where: {
        size_id_product_colour_id: {
          size_id: sizeRow.id,
          product_colour_id: colourRow.id,
        },
      },
      select: { product_colour_id: true },
    });
    if (!stockRow) {
      throw new Error(
        `Unknown color/size combination "${colour}/${size}" for this product`,
      );
    }

    return { productColourId: colourRow.id, sizeId: sizeRow.id };
  }

  /**
   * Releases reserved stock back to a variant. No availability guard needed —
   * restocking can't fail. Does NOT fire the back-in-stock notification
   * itself — that does an SMS send + a delete on the plain (non-tx) prisma
   * client, so firing it inside this transaction would survive a rollback.
   * Returns true when this restock crossed stock from 0 to positive, so
   * the caller can notify once its transaction has actually committed.
   */
  private async restockVariant(
    tx: Prisma.TransactionClient,
    productColourId: number,
    sizeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (quantity <= 0) return false;
    const before = await tx.product_stock.findUnique({
      where: {
        size_id_product_colour_id: {
          size_id: sizeId,
          product_colour_id: productColourId,
        },
      },
    });
    const beforeStock = before?.stock ?? 0;

    await tx.product_stock.update({
      where: {
        size_id_product_colour_id: {
          size_id: sizeId,
          product_colour_id: productColourId,
        },
      },
      data: { stock: { increment: quantity } },
    });

    const afterStock = beforeStock + quantity;
    return beforeStock <= 0 && afterStock > 0;
  }

  /**
   * Reserves stock for a variant, same race-safe updateMany + count guard as
   * create()'s stock reservation. Throws InsufficientStockError if unavailable.
   */
  private async reserveVariant(
    tx: Prisma.TransactionClient,
    productColourId: number,
    sizeId: number,
    quantity: number,
    itemName: string,
    colour: string,
    size: string,
  ) {
    if (quantity <= 0) return;
    const decremented = await tx.product_stock.updateMany({
      where: {
        product_colour_id: productColourId,
        size_id: sizeId,
        stock: { gte: quantity },
      },
      data: { stock: { decrement: quantity } },
    });

    if (decremented.count === 0) {
      const current = await tx.product_stock.findUnique({
        where: {
          size_id_product_colour_id: {
            size_id: sizeId,
            product_colour_id: productColourId,
          },
        },
        select: { stock: true },
      });
      throw new InsufficientStockError([
        {
          name: itemName,
          color: colour,
          size,
          requested: quantity,
          available: current?.stock ?? 0,
        },
      ]);
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
    const normalizedStatus = status.trim().toLowerCase() as DeliveryStatusValue;
    if (!["pending", "shipped", "delivered", "cancelled"].includes(normalizedStatus)) {
      throw new Error("delivery status must be pending, shipped, delivered, or cancelled");
    }

    let restockedVariants: { productColourId: number; sizeId: number }[] = [];

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const existing = await tx.orders.findFirst({
        where: { id: orderId, deleted_at: null },
        select: { id: true, payment_status: true, delivery_status: true },
      });
      if (!existing) throw new Error("Order not found");

      // Same guard as updateOrder: a cancelled order's stock has been
      // released, so moving it back to an active status would leave it
      // fulfilling items it no longer holds.
      const cancelledMessage =
        "Cannot move a cancelled order back to an active delivery status";
      const deliveredMessage =
        "Cannot cancel an order that has already been delivered";

      if (existing.delivery_status === "cancelled" && normalizedStatus !== "cancelled") {
        throw new Error(cancelledMessage);
      }
      if (existing.delivery_status === "delivered" && normalizedStatus === "cancelled") {
        throw new Error(deliveredMessage);
      }

      if (normalizedStatus === "cancelled") {
        // Atomic claim (same updateMany + count idiom as cancelOrder): only
        // the call that actually flips the order into "cancelled" restocks,
        // so a duplicate/retried request can't double-restock. The claim is
        // guarded on the not-yet-released state (not cancelled, payment not
        // failed) at write time, so a concurrent fail/cancel can't make us
        // restock a second time. Delivered orders are refused.
        const claimWithRestock = await tx.orders.updateMany({
          where: {
            id: orderId,
            deleted_at: null,
            delivery_status: { notIn: ["cancelled", "delivered"] },
            payment_status: { not: "failed" },
          },
          data: { delivery_status: "cancelled" },
        });
        if (claimWithRestock.count > 0) {
          restockedVariants = await this.restockAllItems(tx, orderId);
        } else {
          // Payment already failed (stock already released by
          // updateOrderPayment): cancel without restocking.
          const claimNoRestock = await tx.orders.updateMany({
            where: {
              id: orderId,
              deleted_at: null,
              delivery_status: { notIn: ["cancelled", "delivered"] },
            },
            data: { delivery_status: "cancelled" },
          });
          if (claimNoRestock.count === 0) {
            const latest = await tx.orders.findUnique({
              where: { id: orderId },
              select: { delivery_status: true },
            });
            if (latest?.delivery_status === "delivered") {
              throw new Error(deliveredMessage);
            }
            // else already cancelled (duplicate request): idempotent no-op.
          }
        }
      } else {
        // Guarded write: a concurrent cancel between the read above and this
        // write must not be silently reverted to an active status.
        const moved = await tx.orders.updateMany({
          where: { id: orderId, deleted_at: null, delivery_status: { not: "cancelled" } },
          data: { delivery_status: normalizedStatus },
        });
        if (moved.count === 0) throw new Error(cancelledMessage);
      }

      return tx.orders.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, billing_details: true },
      });
    });

    // Back-in-stock notifications only after commit (see restockVariant).
    for (const variant of restockedVariants) {
      await stockNotificationService.notifyBackInStock(
        variant.productColourId,
        variant.sizeId,
      );
    }

    await this.notifyDeliveryStatusChanged(updatedOrder, normalizedStatus, actorUserId);

    return updatedOrder;
  }

  private async notifyDeliveryStatusChanged(
    order: { id: number; user_id: number | null; order_number: string | null },
    status: DeliveryStatusValue,
    actorUserId?: number | null,
  ) {
    const recipientUserId = Number(order.user_id);
    if (!Number.isInteger(recipientUserId) || recipientUserId <= 0) return;

    await notificationService.createInAppNotification({
      type: "delivery.status_changed",
      title: "Delivery status updated",
      body: `Delivery status for order ${order.order_number || `#${order.id}`} is now ${status}.`,
      recipientUserId,
      actorUserId:
        Number.isInteger(Number(actorUserId)) && Number(actorUserId) > 0
          ? Number(actorUserId)
          : null,
      entityType: "ORDER",
      entityId: String(order.id),
      actionUrl: "/member/market/orders",
      priority: "MEDIUM",
      dedupeKey: `order:${order.id}:delivery:${status}`,
      sendSms: true,
      smsBody: `Delivery status for order ${order.order_number || `#${order.id}`} is now ${status}.`,
    });
  }

  /**
   * Applies the same status change to many orders independently. Each order
   * goes through updateOrder (identical transition guards, restock on
   * cancel/fail) after a pre-check that skips non-sensical transitions
   * (shipping unpaid orders, paying cancelled ones, no-op changes). Delivery
   * changes notify the member exactly like update-delivery-status; payment
   * changes do not notify, matching update-order.
   */
  async bulkUpdateStatus(
    orderIds: number[],
    changes: { payment_status?: PaymentStatusValue; delivery_status?: DeliveryStatusValue },
    actorUserId?: number | null,
  ) {
    const uniqueIds = Array.from(new Set(orderIds));
    const updated: number[] = [];
    const skipped: { id: number; reason: string }[] = [];

    const existing = await prisma.orders.findMany({
      where: { id: { in: uniqueIds }, deleted_at: null },
      select: { id: true, payment_status: true, delivery_status: true },
    });
    const existingById = new Map(existing.map((order) => [order.id, order]));

    const processOne = async (id: number) => {
      const current = existingById.get(id);
      if (!current) {
        skipped.push({ id, reason: "Order not found" });
        return;
      }
      const reason = bulkTransitionSkipReason(current, changes);
      if (reason) {
        skipped.push({ id, reason });
        return;
      }

      try {
        const result = await this.updateOrder({
          id,
          payment_status: changes.payment_status,
          delivery_status: changes.delivery_status,
        });
        updated.push(id);

        if (
          changes.delivery_status &&
          changes.delivery_status !== current.delivery_status
        ) {
          try {
            await this.notifyDeliveryStatusChanged(
              result,
              changes.delivery_status,
              actorUserId,
            );
          } catch (error: any) {
            console.error(
              `bulkUpdateStatus: notification failed for order ${id}:`,
              error?.message || error,
            );
          }
        }
      } catch (error: any) {
        skipped.push({ id, reason: error?.message || "Failed to update order" });
      }
    };

    const BATCH_SIZE = 10;
    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      await Promise.all(uniqueIds.slice(i, i + BATCH_SIZE).map(processOne));
    }

    updated.sort((a, b) => a - b);
    skipped.sort((a, b) => a.id - b.id);
    return { updated, skipped };
  }

  /**
   * KPI snapshot for the admin marketplace overview. See
   * docs/MARKETPLACE_FULFILMENT_AND_OVERVIEW.md for field definitions.
   * A handful of bounded queries aggregated in JS — no per-order lookups.
   */
  async getMarketplaceOverview(filters: { market_id?: number; branch_id?: number }) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const TREND_DAYS = 14;
    const trendStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (TREND_DAYS - 1),
    );
    const windowStart = trendStart < monthStart ? trendStart : monthStart;

    // Market scope: explicit market, markets of a branch, or both (intersection).
    let scopedMarketIds: number[] | null = null;
    if (filters.branch_id != null) {
      const branchMarkets = await prisma.markets.findMany({
        where: {
          branch_id: filters.branch_id,
          ...(filters.market_id != null && { id: filters.market_id }),
        },
        select: { id: true },
      });
      scopedMarketIds = branchMarkets.map((m) => m.id);
    } else if (filters.market_id != null) {
      scopedMarketIds = [filters.market_id];
    }
    // Delivery fees belong to the whole order, not a market or branch —
    // only counted when the overview is unscoped (no market_id, no branch_id).
    const includeDeliveryFees = scopedMarketIds == null;

    const itemScope: Prisma.order_itemsWhereInput =
      scopedMarketIds != null ? { market_id: { in: scopedMarketIds } } : {};
    const orderScope: Prisma.ordersWhereInput =
      scopedMarketIds != null ? { items: { some: itemScope } } : {};

    const activeMarketWhere: Prisma.marketsWhereInput = {
      deleted: false,
      AND: [
        { OR: [{ start_date: null }, { start_date: { lte: now } }] },
        { OR: [{ end_date: null }, { end_date: { gte: now } }] },
      ],
      ...(scopedMarketIds != null && { id: { in: scopedMarketIds } }),
    };
    const notEndedMarketWhere: Prisma.marketsWhereInput = {
      deleted: false,
      OR: [{ end_date: null }, { end_date: { gte: now } }],
      ...(scopedMarketIds != null && { id: { in: scopedMarketIds } }),
    };
    const paidOrderWhere: Prisma.ordersWhereInput = {
      deleted_at: null,
      payment_status: "success",
      delivery_status: { not: "cancelled" },
    };

    const [windowOrders, toFulfil, awaitingPayment, lowStockVariants, topGroups] =
      await Promise.all([
        prisma.orders.findMany({
          where: {
            deleted_at: null,
            created_at: { gte: windowStart, lt: nextMonthStart },
            ...orderScope,
          },
          select: {
            payment_status: true,
            delivery_status: true,
            delivery_fee: true,
            created_at: true,
            items: { where: itemScope, select: { price_amount: true, quantity: true } },
          },
        }),
        prisma.orders.count({
          where: {
            deleted_at: null,
            payment_status: "success",
            delivery_status: "pending",
            ...orderScope,
          },
        }),
        prisma.orders.count({
          where: {
            deleted_at: null,
            payment_status: { in: ["pending", "failed"] },
            delivery_status: { not: "cancelled" },
            ...orderScope,
          },
        }),
        prisma.product_stock.count({
          where: {
            stock: { lte: 3 },
            product_colour: {
              product: {
                deleted: false,
                status: "published",
                stock_managed: { not: "no" },
                market: activeMarketWhere,
              },
            },
          },
        }),
        prisma.order_items.groupBy({
          by: ["product_id"],
          where: {
            product_id: { not: null },
            order: paidOrderWhere,
            market: notEndedMarketWhere,
          },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 5,
        }),
      ]);

    const isPaid = (o: { payment_status: string; delivery_status: string }) =>
      o.payment_status === "success" && o.delivery_status !== "cancelled";
    const orderRevenue = (o: (typeof windowOrders)[number]) =>
      o.items.reduce((sum, item) => sum + item.price_amount * item.quantity, 0) +
      (includeDeliveryFees ? o.delivery_fee ?? 0 : 0);

    let revenue = 0;
    let paidOrders = 0;
    let ordersInPeriod = 0;
    let cancelled = 0;
    let itemsSold = 0;
    const trendByDay = new Map<string, number>();

    for (const order of windowOrders) {
      const paid = isPaid(order);
      if (order.created_at >= monthStart && order.created_at < nextMonthStart) {
        ordersInPeriod += 1;
        if (order.delivery_status === "cancelled") cancelled += 1;
        if (paid) {
          paidOrders += 1;
          revenue += orderRevenue(order);
          itemsSold += order.items.reduce((sum, item) => sum + item.quantity, 0);
        }
      }
      if (paid && order.created_at >= trendStart) {
        const key = toDateKey(order.created_at);
        trendByDay.set(key, (trendByDay.get(key) ?? 0) + orderRevenue(order));
      }
    }

    const trend: { date: string; revenue: number }[] = [];
    for (let i = 0; i < TREND_DAYS; i += 1) {
      const day = new Date(
        trendStart.getFullYear(),
        trendStart.getMonth(),
        trendStart.getDate() + i,
      );
      const key = toDateKey(day);
      trend.push({ date: key, revenue: roundMoney(trendByDay.get(key) ?? 0) });
    }

    // Top products: units from the groupBy, revenue + display data from two
    // bounded follow-up queries over just those (<= 5) product ids.
    const topProductIds = topGroups
      .map((g) => g.product_id)
      .filter((id): id is number => id != null);
    const [topItems, topProductRows] = topProductIds.length
      ? await Promise.all([
          prisma.order_items.findMany({
            where: {
              product_id: { in: topProductIds },
              order: paidOrderWhere,
              market: notEndedMarketWhere,
            },
            select: { product_id: true, price_amount: true, quantity: true },
          }),
          prisma.products.findMany({
            where: { id: { in: topProductIds } },
            select: {
              id: true,
              name: true,
              image_url: true,
              market: { select: { name: true } },
              product_colours: {
                where: { image_url: { not: null } },
                orderBy: { id: "asc" },
                take: 1,
                select: { image_url: true },
              },
            },
          }),
        ])
      : [[], []];

    const revenueByProduct = new Map<number, number>();
    for (const item of topItems) {
      if (item.product_id == null) continue;
      revenueByProduct.set(
        item.product_id,
        (revenueByProduct.get(item.product_id) ?? 0) + item.price_amount * item.quantity,
      );
    }
    const productById = new Map(topProductRows.map((p) => [p.id, p]));

    const top_products = topGroups
      .filter((g) => g.product_id != null)
      .map((g) => {
        const productId = g.product_id as number;
        const product = productById.get(productId);
        return {
          product_id: productId,
          name: product?.name ?? null,
          market_name: product?.market?.name ?? null,
          image_url:
            product?.product_colours[0]?.image_url || product?.image_url || null,
          units: g._sum.quantity ?? 0,
          revenue: roundMoney(revenueByProduct.get(productId) ?? 0),
        };
      });

    revenue = roundMoney(revenue);

    return {
      period: { from: toDateKey(monthStart), to: toDateKey(monthEnd) },
      revenue,
      paid_orders: paidOrders,
      orders: ordersInPeriod,
      cancelled,
      average_order: paidOrders > 0 ? roundMoney(revenue / paidOrders) : 0,
      items_sold: itemsSold,
      to_fulfil: toFulfil,
      awaiting_payment: awaitingPayment,
      low_stock_variants: lowStockVariants,
      trend,
      top_products,
    };
  }

  async cancelOrder(orderId: number, actorUserId?: number | null) {
    // Atomic guard against the TOCTOU race between checking payment_status
    // and writing delivery_status: a webhook could flip payment_status to
    // "success" between a separate findUnique + update, leaving a
    // contradictory success/cancelled order with no refund path. Same
    // updateMany + count===0 idiom as the stock reservation guard in
    // create(). Also excludes already-cancelled orders: cancelOrder doesn't
    // move payment_status off "pending", so without this a duplicate/retried
    // call would match again and double-restock below.
    const cancelled = await prisma.orders.updateMany({
      where: {
        id: orderId,
        payment_status: "pending",
        delivery_status: { not: "cancelled" },
        deleted_at: null,
      },
      data: { delivery_status: "cancelled" },
    });

    if (cancelled.count === 0) {
      const existing = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { id: true },
      });
      if (!existing) throw new Error("Order not found");
      throw new Error("Only orders awaiting payment can be cancelled");
    }

    // Cancelling never released the stock reserved at order-creation time,
    // permanently locking it (or, for Hubtel, locking it for up to 48h
    // until the reconciliation cron force-fails it). Release it the same
    // way a failed payment does.
    await this.restockOrderItems(orderId);

    // updateMany doesn't return the updated row, so re-read the full order
    // (with items/billing_details) for the return value and notification.
    const updatedOrder = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { items: true, billing_details: true },
    });
    if (!updatedOrder) throw new Error("Order not found");

    const recipientUserId = Number(updatedOrder.user_id);
    if (Number.isInteger(recipientUserId) && recipientUserId > 0) {
      await notificationService.createInAppNotification({
        type: "order.cancelled",
        title: "Order cancelled",
        body: `Order ${updatedOrder.order_number || `#${updatedOrder.id}`} was cancelled.`,
        recipientUserId,
        actorUserId:
          Number.isInteger(Number(actorUserId)) && Number(actorUserId) > 0
            ? Number(actorUserId)
            : null,
        entityType: "ORDER",
        entityId: String(updatedOrder.id),
        actionUrl: "/member/market/orders",
        priority: "MEDIUM",
        dedupeKey: `order:${updatedOrder.id}:cancelled`,
      });
    }

    return updatedOrder;
  }

  /**
   * Soft-deletes an order. A pending order that hasn't already been
   * cancelled releases its reserved stock and has its payment reference
   * marked "failed" (so the reconciliation sweep or a stale checkout link
   * can no longer settle or re-scan it) — atomically claimed with the same
   * updateMany + count guard cancelOrder uses, closing the same
   * webhook-race / duplicate-delete window cancelOrder's own comments
   * document. An order that's already paid, already failed, or already
   * cancelled (stock already settled one way or the other) is soft-deleted
   * without touching stock or payment_status.
   *
   * Residual gap, accepted: an in-flight Hubtel/Paystack webhook that
   * confirms "success" for a reference this just marked "failed" will
   * still flip it to "success" (checkHubtelTransactionStatus /
   * updateOrderStatusByHubtel are deliberately unfiltered by deleted_at —
   * a real payment landing needs to be recorded, not dropped). That's the
   * same class of residual risk cancelOrder already carries.
   */
  async deleteOrder(orderId: number, actorUserId?: number | null) {
    // Threaded through for a future customer-notification decision on
    // delete (deliberately not acted on yet — matches cancelOrder/
    // updateDeliveryStatus's actorUserId param shape for when that's added).
    void actorUserId;

    // deleted_at + the restock it can trigger must commit together — doing
    // them as two separate top-level statements let a restockAllItems
    // failure reject deleteOrder (surfacing as "skipped" to bulkDeleteOrders'
    // Promise.allSettled) even though the soft-delete had already persisted,
    // silently lying about what actually happened.
    let restockedVariants: { productColourId: number; sizeId: number }[] = [];

    await prisma.$transaction(async (tx) => {
      const restockClaim = await tx.orders.updateMany({
        where: {
          id: orderId,
          deleted_at: null,
          payment_status: "pending",
          delivery_status: { not: "cancelled" },
        },
        data: { deleted_at: new Date(), payment_status: "failed" },
      });

      if (restockClaim.count > 0) {
        restockedVariants = await this.restockAllItems(tx, orderId);
        return;
      }

      const claim = await tx.orders.updateMany({
        where: { id: orderId, deleted_at: null },
        data: { deleted_at: new Date() },
      });

      if (claim.count === 0) {
        const existing = await tx.orders.findFirst({
          where: { id: orderId },
          select: { id: true },
        });
        if (!existing) throw new Error("Order not found");
        // else: already soft-deleted by a concurrent call — idempotent no-op.
      }
    });

    // Fire back-in-stock notifications only after the transaction has
    // actually committed — restockVariant deliberately doesn't do this
    // itself (see its docstring).
    for (const variant of restockedVariants) {
      await stockNotificationService.notifyBackInStock(
        variant.productColourId,
        variant.sizeId,
      );
    }

    return { id: orderId };
  }

  /** Soft-deletes many orders independently — one bad id doesn't block the rest. */
  async bulkDeleteOrders(orderIds: number[], actorUserId?: number | null) {
    const uniqueIds = Array.from(new Set(orderIds));
    const BATCH_SIZE = 20;
    const deleted: number[] = [];
    const skipped: number[] = [];

    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((id) => this.deleteOrder(id, actorUserId)),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          deleted.push(batch[index]);
        } else {
          skipped.push(batch[index]);
          console.error(
            `bulkDeleteOrders: failed to delete order ${batch[index]}:`,
            result.reason?.message || result.reason,
          );
        }
      });
    }

    return { deleted: deleted.length, skipped };
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

  /**
   * Starts a Paystack transaction for an order and returns the checkout
   * (authorization) URL to redirect the buyer to. Verification after the
   * buyer returns is handled separately by verifyPaymentStatus.
   */
  async initializePaystackTransaction(order: any, return_url: string | null) {
    return initializeTransaction({
      email: order.billing_details.email,
      // Paystack takes minor units (pesewas/cents); order.total_amount is
      // stored in major units.
      amount: Math.round(order.total_amount * 100),
      currency: order.items[0]?.price_currency || "GHS",
      reference: order.reference,
      ...(return_url && { callback_url: return_url }),
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
      },
    });
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
    const order = await prisma.orders.findFirst({
      where: { id, deleted_at: null },
      select: {
        reference: true,
        payment_status: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }
    if (order.payment_status === "success") {
      return { success: true };
    }
    if (order.reference.startsWith("MANUAL-")) {
      // No real Hubtel transaction behind a manually-placed order — same
      // guard as verifyPaymentStatus.
      return {
        message: "This order was placed manually and has no payment to verify",
      };
    }
    return await this.checkHubtelTransactionStatus(order.reference);
  }

  async reconcilePendingHubtelPayments(limit = 100) {
    const STALE_PENDING_MS = 48 * 60 * 60 * 1000;
    const now = Date.now();

    // Oldest-first: scanning the newest N pending orders every run meant a
    // backlog bigger than the limit could NEVER drain — the same fresh
    // batch always won the slot and the tail rotted indefinitely. Oldest
    // (most overdue) orders get serviced first instead.
    const pendingOrders = await prisma.orders.findMany({
      // Exclude orders the member already cancelled — cancelOrder() leaves
      // payment_status "pending" by design (only delivery_status moves to
      // "cancelled"), so without this filter a cancelled order stays visible
      // to this sweep. Once it goes stale, force-failing it would call
      // updateOrderPayment(id, "failed"), which restocks again on top of the
      // restock cancelOrder() already did — a double stock credit.
      // Manual orders (created via createForMember with no real gateway
      // transaction) are prefixed "MANUAL-" and excluded — there's nothing
      // for Hubtel to confirm, so this sweep would otherwise force-fail
      // them as unrecognized references after 48h.
      where: {
        payment_status: "pending",
        delivery_status: { not: "cancelled" },
        deleted_at: null,
        NOT: { reference: { startsWith: "MANUAL-" } },
      },
      orderBy: { created_at: "asc" },
      take: limit,
      select: { id: true, reference: true, payment_status: true, created_at: true },
    });

    const results = await Promise.allSettled(
      pendingOrders.map(async (order) => {
        const isStale = now - order.created_at.getTime() > STALE_PENDING_MS;

        try {
          const result = await this.checkHubtelTransactionStatus(order.reference);
          const stillPending = result?.order?.payment_status === "pending";

          if (stillPending && isStale) {
            return this.updateOrderStatusByHubtel(order.reference, "failed");
          }
          return result;
        } catch (error) {
          // Force-fail on staleness even when the live Hubtel status check
          // itself errors (bad creds, IP block, unrecognized/expired
          // reference) — otherwise this safety net never fires for
          // exactly the orders that need it most.
          if (isStale) {
            return this.updateOrderStatusByHubtel(order.reference, "failed");
          }
          throw error;
        }
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

  /**
   * Finds an open (payment_status "pending") order for this user whose
   * items exactly match the incoming cart — same product/color/size/qty,
   * any order. Scoped to identified users only; guest checkouts have no
   * stable identity to dedupe against.
   */
  private async findMatchingPendingOrder(
    data: {
      user_id?: number | string | null;
      items: {
        id?: number | string;
        product_id?: number | string;
        color: string;
        size: string;
        quantity: number;
      }[];
    },
    fulfilment: ResolvedFulfilment,
  ) {
    const userId = Number(data.user_id);
    if (!Number.isInteger(userId) || userId <= 0) return null;

    const incomingSignature = this.buildIncomingItemSignature(data.items);

    const candidates = await prisma.orders.findMany({
      // Cancelled orders keep payment_status "pending" (cancelOrder only moves
      // delivery_status) but their stock has been released — never reuse one.
      where: {
        user_id: userId,
        payment_status: "pending",
        delivery_status: { not: "cancelled" },
        deleted_at: null,
      },
      orderBy: { id: "desc" },
      take: 20,
      include: { items: true },
    });

    // Fulfilment is part of the identity: switching pickup -> delivery (or
    // changing the address / fee) must not reuse an order whose stored total
    // was computed for a different fulfilment.
    return (
      candidates.find(
        (order) =>
          this.buildStoredItemSignature(order.items) === incomingSignature &&
          order.fulfilment_method === fulfilment.fulfilment_method &&
          (order.delivery_address ?? null) === fulfilment.delivery_address &&
          roundMoney(order.delivery_fee ?? 0) === fulfilment.delivery_fee,
      ) ?? null
    );
  }

  private buildIncomingItemSignature(
    items: {
      id?: number | string;
      product_id?: number | string;
      color: string;
      size: string;
      quantity: number;
    }[],
  ): string {
    return items
      .map((item) => {
        const productId = Number(item.id ?? item.product_id);
        return `${productId}:${item.color}:${item.size}:${Number(item.quantity)}`;
      })
      .sort()
      .join("|");
  }

  private buildStoredItemSignature(
    items: {
      product_id: number | null;
      color: string;
      size: string;
      quantity: number;
    }[],
  ): string {
    return items
      .map((item) => `${item.product_id}:${item.color}:${item.size}:${item.quantity}`)
      .sort()
      .join("|");
  }

  /**
   * Reuses an existing pending order for a retried checkout instead of
   * creating a new one — no new order row, no second stock reservation.
   * Just rolls the payment reference and re-initiates with whichever
   * gateway the client asked for this time.
   */
  private async reuseExistingPendingOrder(
    order: { id: number },
    data: {
      payment_type: "paystack" | "hubtel" | null;
      return_url: string | null;
      cancellation_url: string | null;
    },
  ) {
    const clientReference = this.generateReference();
    const updatedOrder = await prisma.orders.update({
      where: { id: order.id },
      data: { reference: clientReference },
      include: { items: true, billing_details: true },
    });

    if (data.payment_type === "paystack") {
      const paystackResponse = await this.initializePaystackTransaction(
        updatedOrder,
        data.return_url,
      );
      return {
        message: "Paystack payment initiated",
        checkoutUrl: paystackResponse.authorization_url,
        clientReference: paystackResponse.reference,
        updated_order: updatedOrder,
      };
    }

    const hubtelResponse = await this.initializeHubtelTransaction(
      updatedOrder,
      data.return_url,
      data.cancellation_url,
    );
    return {
      message: "Hubtel payment initiated",
      checkoutUrl: hubtelResponse.checkoutUrl,
      checkoutDirectUrl: hubtelResponse.checkoutDirectUrl,
      clientReference: hubtelResponse.clientReference,
      checkoutId: hubtelResponse.checkoutId,
      updated_order: updatedOrder,
    };
  }

  private async resolveItemStock(
    items: {
      id?: string | number;
      product_id?: string | number;
      name: string;
      color: string;
      size: string;
      quantity: number;
      price_currency?: string;
    }[],
  ): Promise<ResolvedOrderItem[]> {
    // Web checkout items carry `product_id`, not `id` — fall back so both
    // client shapes resolve to the same product id.
    const invalidItem = items.find(
      (item) => !Number.isInteger(Number(item.id ?? item.product_id)),
    );
    if (invalidItem) {
      throw new Error(
        `Invalid product id "${invalidItem.id ?? invalidItem.product_id}" for item "${invalidItem.name}"`,
      );
    }

    const productIds = [
      ...new Set(items.map((item) => Number(item.id ?? item.product_id))),
    ];

    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        stock_managed: true,
        price_amount: true,
        price_currency: true,
        status: true,
        deleted: true,
        market_id: true,
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Server-authoritative pricing: reject the whole cart up-front if any
    // product is gone or unpriced, before touching stock.
    const priceByItemIndex = items.map((item) =>
      resolveDbUnitPrice(
        productById.get(Number(item.id ?? item.product_id)),
        item.name,
        item.price_currency,
      ),
    );

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

    return items.map((item, index) => {
      const productId = Number(item.id ?? item.product_id);
      const product = productById.get(productId);
      const stockManaged = product?.stock_managed === "yes";
      const quantity = Number(item.quantity);
      const pricing = {
        unitPrice: priceByItemIndex[index].unitPrice,
        priceCurrency: priceByItemIndex[index].priceCurrency,
        marketId: product?.market_id ?? null,
      };

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
          ...pricing,
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
        ...pricing,
      };
    });
  }

  /** Line items shaped for computeOrderTotal, using DB unit prices. */
  private toPricedItems(resolved: ResolvedOrderItem[]) {
    return resolved.map((item) => ({
      price_amount: item.unitPrice,
      quantity: item.quantity,
    }));
  }

  private buildItems(items: any[], resolved: ResolvedOrderItem[]) {
    return items.map((item, index) => {
      const match = resolved[index];
      return {
        name: item.name,
        product_id: Number(item.id ?? item.product_id),
        // DB price, not the client's — keeps stored lines consistent with
        // the server-computed orders.total_amount.
        price_amount: match.unitPrice,
        market_id:
          item.market_id != null && Number.isInteger(Number(item.market_id))
            ? Number(item.market_id)
            : match.marketId ?? undefined,
        price_currency: match.priceCurrency,
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
      const orderById = await prisma.orders.findFirst({
        where: { id: Number(cleanedToken), deleted_at: null },
        include: { items: true, billing_details: true },
      });
      if (orderById) return orderById;
    }

    return prisma.orders.findFirst({
      where: {
        deleted_at: null,
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
        // Same cancelled-order exclusion as reconcilePendingHubtelPayments:
        // this scan also drives updateOrderStatusByHubtel -> updateOrderPayment,
        // which would restock an already-cancelled (and already-restocked)
        // order a second time if Hubtel reports it failed/cancelled upstream.
        // Same reasoning applies to a soft-deleted order, and to a manual
        // order (createForMember) that has no real Hubtel transaction
        // behind it at all.
        delivery_status: { not: "cancelled" },
        deleted_at: null,
        NOT: { reference: { startsWith: "MANUAL-" } },
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
              // Prefer the direct FK join (set at checkout for every order
              // since product_colour_id/size_id were added). Older
              // order_items predate that column and are always NULL there,
              // so fall back to matching this item's snapshotted hex
              // (`color`) against the product's current colour catalog —
              // recovers the name for old orders as long as the product
              // still carries that swatch.
              colour_name:
                item.product_colour?.colour_name ??
                item.product?.product_colours?.find(
                  (c: any) => c.colour === item.color,
                )?.colour_name ??
                null,
              size: item.size,

              // Order fields
              order_number: order.order_number,
              payment_status: order.payment_status,
              delivery_status: order.delivery_status,
              reference: order.reference,
              created_at: order.created_at,
              fulfilment_method: order.fulfilment_method ?? "pickup",
              delivery_address: order.delivery_address ?? null,
              delivery_fee: order.delivery_fee ?? 0,
              placed_by_staff_id: order.placed_by_staff_id ?? null,
              // Whole-order stored total (items + delivery fee). Distinct from
              // the per-item `total_amount` below, which must stay as-is.
              order_total: order.total_amount,

              // Flattened product fields
              product_name: item.product?.name,
              product_description: item.product?.description,
              // `products.colours` is a dead legacy scalar (superseded by
              // the product_colour relation) — this used to point at it by
              // mistake, silently defeating the Frontend's own colour_name
              // fallback for every order. `product_colours` (plural) is the
              // real relation and matches what IOrders.product_colours
              // (Frontend) expects: ProductColour[] with colour/colour_name.
              product_colours: item.product?.product_colours,
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
}
