import test from "node:test";
import assert from "node:assert/strict";
import {
  bulkTransitionSkipReason,
  computeOrderTotal,
  DEFAULT_DELIVERY_FEE,
  DEFAULT_PICKUP_LOCATION,
  FulfilmentValidationError,
  getMarketplaceDeliveryConfig,
  resolveDbUnitPrice,
  resolveFulfilment,
} from "./marketplaceFulfilment";

test("getMarketplaceDeliveryConfig defaults", () => {
  assert.deepEqual(getMarketplaceDeliveryConfig({}), {
    delivery_enabled: true,
    delivery_fee: DEFAULT_DELIVERY_FEE,
    pickup_location: DEFAULT_PICKUP_LOCATION,
  });
});

test("getMarketplaceDeliveryConfig reads env and rejects bad fees", () => {
  const cfg = getMarketplaceDeliveryConfig({
    MARKETPLACE_DELIVERY_ENABLED: "False",
    MARKETPLACE_DELIVERY_FEE: "12.5",
    MARKETPLACE_PICKUP_LOCATION: " Front desk ",
  });
  assert.deepEqual(cfg, { delivery_enabled: false, delivery_fee: 12.5, pickup_location: "Front desk" });
  assert.equal(getMarketplaceDeliveryConfig({ MARKETPLACE_DELIVERY_FEE: "abc" }).delivery_fee, 25);
  assert.equal(getMarketplaceDeliveryConfig({ MARKETPLACE_DELIVERY_FEE: "-3" }).delivery_fee, 25);
  assert.equal(getMarketplaceDeliveryConfig({ MARKETPLACE_DELIVERY_FEE: "0" }).delivery_fee, 0);
});

test("resolveFulfilment: pickup by default, delivery validated", () => {
  const cfg = getMarketplaceDeliveryConfig({});
  assert.deepEqual(resolveFulfilment({}, cfg), { fulfilment_method: "pickup", delivery_address: null, delivery_fee: 0 });
  assert.deepEqual(resolveFulfilment({ fulfilment_method: "pickup", delivery_address: "x" }, cfg), {
    fulfilment_method: "pickup", delivery_address: null, delivery_fee: 0,
  });
  assert.deepEqual(resolveFulfilment({ fulfilment_method: "Delivery", delivery_address: " 1 Main St " }, cfg), {
    fulfilment_method: "delivery", delivery_address: "1 Main St", delivery_fee: 25,
  });
  assert.throws(() => resolveFulfilment({ fulfilment_method: "delivery", delivery_address: "  " }, cfg), FulfilmentValidationError);
  assert.throws(() => resolveFulfilment({ fulfilment_method: "courier" }, cfg), FulfilmentValidationError);
  const off = getMarketplaceDeliveryConfig({ MARKETPLACE_DELIVERY_ENABLED: "false" });
  assert.throws(() => resolveFulfilment({ fulfilment_method: "delivery", delivery_address: "a" }, off), /not available/);
});

test("computeOrderTotal adds fee once and rounds", () => {
  assert.equal(computeOrderTotal([{ price_amount: 10.1, quantity: 3 }, { price_amount: "5", quantity: "2" }], 25), 65.3);
  assert.equal(computeOrderTotal([{ price_amount: 0.1, quantity: 3 }], 0), 0.3);
});

test("bulkTransitionSkipReason", () => {
  const paidPending = { payment_status: "success" as const, delivery_status: "pending" as const };
  const unpaid = { payment_status: "pending" as const, delivery_status: "pending" as const };
  const cancelled = { payment_status: "pending" as const, delivery_status: "cancelled" as const };
  assert.equal(bulkTransitionSkipReason(paidPending, { delivery_status: "shipped" }), null);
  assert.match(bulkTransitionSkipReason(unpaid, { delivery_status: "delivered" })!, /before payment/);
  assert.equal(bulkTransitionSkipReason(unpaid, { payment_status: "success", delivery_status: "delivered" }), null);
  assert.match(bulkTransitionSkipReason(cancelled, { payment_status: "success" })!, /cancelled order/);
  assert.match(bulkTransitionSkipReason(paidPending, { payment_status: "success" })!, /already/);
  assert.equal(bulkTransitionSkipReason(unpaid, { delivery_status: "cancelled" }), null);
});

test("bulkTransitionSkipReason checks the resulting state for payment-only changes", () => {
  const shipped = { payment_status: "success" as const, delivery_status: "shipped" as const };
  const delivered = { payment_status: "success" as const, delivery_status: "delivered" as const };
  assert.match(bulkTransitionSkipReason(shipped, { payment_status: "failed" })!, /Cannot set payment to failed while the order is shipped/);
  assert.match(bulkTransitionSkipReason(delivered, { payment_status: "pending" })!, /Cannot set payment to pending while the order is delivered/);
  // Moving delivery back to pending together with the payment change is fine.
  assert.equal(bulkTransitionSkipReason(shipped, { payment_status: "pending", delivery_status: "pending" }), null);
  // Legacy inconsistent row (shipped but unpaid): pushing to delivered stays blocked.
  assert.match(
    bulkTransitionSkipReason({ payment_status: "pending", delivery_status: "shipped" }, { delivery_status: "delivered" })!,
    /before payment/,
  );
});

test("bulkTransitionSkipReason blocks cancelling a delivered order", () => {
  const delivered = { payment_status: "success" as const, delivery_status: "delivered" as const };
  assert.match(bulkTransitionSkipReason(delivered, { delivery_status: "cancelled" })!, /already been delivered/);
  const shipped = { payment_status: "success" as const, delivery_status: "shipped" as const };
  assert.equal(bulkTransitionSkipReason(shipped, { delivery_status: "cancelled" }), null);
});

test("resolveDbUnitPrice uses the DB price and rejects unavailable products", () => {
  assert.deepEqual(
    resolveDbUnitPrice({ price_amount: 40, price_currency: "GHS", deleted: false }, "Tee", "USD"),
    { unitPrice: 40, priceCurrency: "GHS" },
  );
  assert.deepEqual(
    resolveDbUnitPrice({ price_amount: 0, price_currency: " ", deleted: false }, "Free pin", "USD"),
    { unitPrice: 0, priceCurrency: "USD" },
  );
  assert.equal(resolveDbUnitPrice({ price_amount: 5, price_currency: null, deleted: false }, "x").priceCurrency, "GHS");
  assert.throws(() => resolveDbUnitPrice(undefined, "Tee"), /Product Tee is no longer available/);
  assert.throws(() => resolveDbUnitPrice({ price_amount: 10, price_currency: "GHS", deleted: true }, "Tee"), /no longer available/);
  assert.throws(() => resolveDbUnitPrice({ price_amount: null, price_currency: "GHS", deleted: false }, "Tee"), /no longer available/);
  assert.throws(() => resolveDbUnitPrice({ price_amount: -1, price_currency: "GHS", deleted: false }, "Tee"), /no longer available/);
});
