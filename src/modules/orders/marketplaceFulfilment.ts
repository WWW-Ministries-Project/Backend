/**
 * Marketplace fulfilment (pickup vs delivery) configuration and pure helpers.
 *
 * Env:
 * - MARKETPLACE_DELIVERY_ENABLED  "true" (default) | "false"/"0"/"no"/"off"
 * - MARKETPLACE_DELIVERY_FEE      number in major units (default 25)
 * - MARKETPLACE_PICKUP_LOCATION   free text (default "Church office · after any service")
 *
 * Everything here is pure (env passed in) so it can be unit-tested without a DB.
 */

export type FulfilmentMethod = "pickup" | "delivery";

export const FULFILMENT_METHODS: FulfilmentMethod[] = ["pickup", "delivery"];

export type MarketplaceDeliveryConfig = {
  delivery_enabled: boolean;
  delivery_fee: number;
  pickup_location: string;
};

export const DEFAULT_DELIVERY_FEE = 25;
export const DEFAULT_PICKUP_LOCATION = "Church office · after any service";

const FALSE_VALUES = ["false", "0", "no", "off"];

export function getMarketplaceDeliveryConfig(
  env: Record<string, string | undefined> = process.env,
): MarketplaceDeliveryConfig {
  const rawEnabled = String(env.MARKETPLACE_DELIVERY_ENABLED ?? "true")
    .trim()
    .toLowerCase();

  const rawFee = env.MARKETPLACE_DELIVERY_FEE;
  const parsedFee =
    rawFee != null && rawFee.trim() !== "" ? Number(rawFee) : NaN;
  const delivery_fee =
    Number.isFinite(parsedFee) && parsedFee >= 0
      ? roundMoney(parsedFee)
      : DEFAULT_DELIVERY_FEE;

  const pickup_location =
    env.MARKETPLACE_PICKUP_LOCATION?.trim() || DEFAULT_PICKUP_LOCATION;

  return {
    delivery_enabled: !FALSE_VALUES.includes(rawEnabled),
    delivery_fee,
    pickup_location,
  };
}

export type ResolvedFulfilment = {
  fulfilment_method: FulfilmentMethod;
  delivery_address: string | null;
  delivery_fee: number;
};

/** Thrown for client mistakes in fulfilment input — controllers map it to 400. */
export class FulfilmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FulfilmentValidationError";
  }
}

/**
 * Normalises the optional checkout fields. Omitted method => pickup (old
 * clients never send it). Delivery requires delivery to be enabled and a
 * non-empty address; the fee always comes from config, never the client.
 */
export function resolveFulfilment(
  input: { fulfilment_method?: unknown; delivery_address?: unknown },
  config: MarketplaceDeliveryConfig,
): ResolvedFulfilment {
  const rawMethod =
    input.fulfilment_method == null || input.fulfilment_method === ""
      ? "pickup"
      : String(input.fulfilment_method).trim().toLowerCase();

  if (!FULFILMENT_METHODS.includes(rawMethod as FulfilmentMethod)) {
    throw new FulfilmentValidationError(
      'fulfilment_method must be "pickup" or "delivery"',
    );
  }

  if (rawMethod === "pickup") {
    return { fulfilment_method: "pickup", delivery_address: null, delivery_fee: 0 };
  }

  if (!config.delivery_enabled) {
    throw new FulfilmentValidationError(
      "Delivery is not available right now. Please choose pickup",
    );
  }

  const address =
    typeof input.delivery_address === "string"
      ? input.delivery_address.trim()
      : "";
  if (!address) {
    throw new FulfilmentValidationError(
      "A delivery address is required for delivery orders",
    );
  }

  return {
    fulfilment_method: "delivery",
    delivery_address: address,
    delivery_fee: config.delivery_fee,
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sum of item price_amount * quantity, rounded to 2dp. */
export function computeItemsSubtotal(
  items: { price_amount: number | string; quantity: number | string }[],
): number {
  return roundMoney(
    items.reduce(
      (sum, item) => sum + Number(item.price_amount) * Number(item.quantity),
      0,
    ),
  );
}

/** Authoritative charged total: item subtotal + delivery fee. */
export function computeOrderTotal(
  items: { price_amount: number | string; quantity: number | string }[],
  deliveryFee: number,
): number {
  return roundMoney(computeItemsSubtotal(items) + deliveryFee);
}

export type PaymentStatusValue = "pending" | "success" | "failed";
export type DeliveryStatusValue = "pending" | "shipped" | "delivered" | "cancelled";

/**
 * Pre-check for bulk status updates. Returns a human-readable skip reason, or
 * null when the transition may proceed to updateOrder (which still enforces
 * its own cancelled->active / failed->anything guards).
 */
export function bulkTransitionSkipReason(
  current: { payment_status: PaymentStatusValue; delivery_status: DeliveryStatusValue },
  requested: { payment_status?: PaymentStatusValue; delivery_status?: DeliveryStatusValue },
): string | null {
  const nextPayment = requested.payment_status ?? current.payment_status;
  const nextDelivery = requested.delivery_status ?? current.delivery_status;

  const paymentChanges =
    requested.payment_status !== undefined &&
    requested.payment_status !== current.payment_status;
  const deliveryChanges =
    requested.delivery_status !== undefined &&
    requested.delivery_status !== current.delivery_status;

  if (!paymentChanges && !deliveryChanges) {
    return "Order already has the requested status";
  }

  // Goods already handed over: an order can't be cancelled after delivery.
  if (
    deliveryChanges &&
    nextDelivery === "cancelled" &&
    current.delivery_status === "delivered"
  ) {
    return "Cannot cancel an order that has already been delivered";
  }

  // Shipped/delivered must always sit on a successful payment — checked on
  // the RESULTING state, so it also blocks payment-only changes (success ->
  // pending/failed) on an order that is already shipped/delivered.
  if (
    (nextDelivery === "shipped" || nextDelivery === "delivered") &&
    nextPayment !== "success"
  ) {
    return paymentChanges && !deliveryChanges
      ? `Cannot set payment to ${nextPayment} while the order is ${nextDelivery}`
      : `Cannot mark an order ${nextDelivery} before payment is successful`;
  }

  if (paymentChanges && nextPayment === "success" && nextDelivery === "cancelled") {
    return "Cannot mark a cancelled order as paid";
  }

  return null;
}

/** Local-time YYYY-MM-DD (server timezone), used for overview buckets. */
export function toDateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Server-authoritative unit price for a cart line. Throws (-> 400) when the
 * product no longer exists, is deleted, or has no price. The client's
 * price_amount is never used; its currency is only a fallback when the
 * product has none recorded.
 */
export function resolveDbUnitPrice(
  product:
    | { price_amount: number | null; price_currency: string | null; deleted: boolean }
    | undefined
    | null,
  itemName: string,
  clientCurrency?: string | null,
): { unitPrice: number; priceCurrency: string } {
  if (
    !product ||
    product.deleted ||
    product.price_amount == null ||
    !Number.isFinite(product.price_amount) ||
    product.price_amount < 0
  ) {
    throw new Error(`Product ${itemName} is no longer available`);
  }
  return {
    unitPrice: product.price_amount,
    priceCurrency:
      product.price_currency?.trim() || clientCurrency?.trim() || "GHS",
  };
}
