# Marketplace fulfilment, bulk status and overview: backend contract

Covers pickup/delivery on orders, the public delivery config, bulk status
updates and the admin KPI overview. Everything is additive: no existing
response field was removed or renamed, and old mobile builds that send no
fulfilment fields get pickup orders exactly as before.

Code: `src/modules/orders/marketplaceFulfilment.ts` (config + pure helpers),
`orderService.ts`, `orderController.ts`, `orderRoutes.ts`.
Migration: `prisma/migrations/20261018120000_marketplace_fulfilment`.

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `MARKETPLACE_DELIVERY_ENABLED` | `"true"` | `false` / `0` / `no` / `off` (any case) disables delivery |
| `MARKETPLACE_DELIVERY_FEE` | `25` | Fee in major units (GHS). Non-numeric or negative values fall back to 25 |
| `MARKETPLACE_PICKUP_LOCATION` | `"Church office · after any service"` | Shown to buyers who pick up |

## Data model

`orders` gains:

| Column | Type | Notes |
| --- | --- | --- |
| `fulfilment_method` | enum `pickup` \| `delivery`, default `pickup` | All existing orders are `pickup` |
| `delivery_address` | `TEXT NULL` | Set only for delivery |
| `delivery_fee` | `DOUBLE`, default `0` | Already included in `total_amount` |

## GET `/orders/delivery-config` (public, no auth)

```json
{
  "message": "Delivery config retrieved successfully",
  "data": {
    "delivery_enabled": true,
    "delivery_fee": 25,
    "pickup_location": "Church office · after any service"
  }
}
```

## POST `/orders/create-order` and POST `/orders/create-for-member`

New optional body fields (both endpoints):

```json
{
  "fulfilment_method": "pickup | delivery",
  "delivery_address": "12 Ring Road, Accra"
}
```

- `fulfilment_method` omitted, `null` or `""` means `pickup`. Any other value
  is rejected with 400 `fulfilment_method must be "pickup" or "delivery"`.
- `delivery`: 400 `Delivery is not available right now. Please choose pickup`
  when delivery is disabled; 400 `A delivery address is required for delivery orders`
  when the address is missing or blank. The address is trimmed. `delivery_fee`
  is the configured fee. Clients never send the fee.
- `pickup`: `delivery_fee = 0` and `delivery_address = null`, even if the client
  sent an address.

**Prices and the total come from the server.** Each line's `price_amount` is
read from `products.price_amount`. The client's `price_amount` is ignored.
`price_currency` comes from `products.price_currency`, falling back to the
client's value and then to `GHS`. `market_id` falls back to
`products.market_id` when the client omits it. If a product is missing,
deleted or has no price, the whole cart is rejected with 400
`Product <name> is no longer available`. The stored and charged total is
`round2(sum(db_price * quantity) + delivery_fee)`. The client's `total_amount` is
optional and only informational: if it differs from the server total, the
server logs a warning and uses its own value. So a client that already added
the fee is not charged it twice, and a client that left it out still pays it.
Paystack (`amount = total * 100`) and Hubtel (`totalAmount`) both read the
stored `total_amount`, so the fee reaches the gateway, including on
reinitiate/retry.

`create-order` now also returns 400 when `items` is empty or when a quantity is not a
positive integer. `create-for-member` uses DB prices too, in both manual and
gateway modes, and no longer validates the client's `price_amount`.

**Pending-order reuse:** a retried checkout reuses an existing pending order
only when the items match (as before) **and** the `fulfilment_method`,
`delivery_address` and `delivery_fee` all match. Cancelled orders are no longer
reused. Their payment stays `pending`, but their stock has been released.

Responses are unchanged. `updated_order` (and the manual create-for-member
order) now also carries `fulfilment_method`, `delivery_address` and
`delivery_fee`.

`PUT /orders/update-order` with item edits now recomputes
`total_amount = items + order.delivery_fee`. Before this change it dropped the fee.
Admin item edits still use the `price_amount` sent by the admin, so admins can
deliberately re-price a line.

`update-order` also now:
- rejects cancelling a delivered order with 400
  `Cannot cancel an order that has already been delivered`;
- writes status changes and item edits through a check on the
  payment/delivery state it read. If another request changed the order in
  the meantime (a concurrent cancel, fail or payment webhook), it returns 409
  `This order was changed by someone else while you were updating it. Refresh and try again`
  and changes nothing. This prevents the double restock that a stale read
  allowed before.

## Order list rows (flattenOrders)

Applies to `get-all-orders`, `get-orders-by-user` and `get-orders-by-market`
(and the unrouted `findOrderByName` service method). Each row (one per item) gains:

```ts
fulfilment_method: "pickup" | "delivery";
delivery_address: string | null;
delivery_fee: number;
placed_by_staff_id: number | null;
order_total: number;      // the order's stored total_amount (items + fee)
```

The existing `total_amount` row field is still the per-item
`price_amount * quantity`.

`GET /orders/get-order-by-id` returns the raw order row, so the three new
columns appear there automatically.

## PUT `/orders/bulk-update-status` (protect + `can_manage_marketplace`)

Request:

```json
{
  "ids": [101, 102, 103],
  "payment_status": "pending | success | failed",
  "delivery_status": "pending | shipped | delivered | cancelled"
}
```

- `ids`: 1 to 500 positive integers, de-duplicated. At least one of the two status
  fields must be present.
- 400 messages: `ids must be a non-empty array of order ids`,
  `Cannot update more than 500 orders at once`, `Every id must be a positive integer`,
  `Provide payment_status and/or delivery_status`,
  `payment_status must be pending, success, or failed`,
  `delivery_status must be pending, shipped, delivered, or cancelled`.

The server checks each order on its own. It is skipped with a reason when:

- `Order not found`: the id is missing or soft-deleted.
- `Order already has the requested status`: nothing would change.
- `Cannot cancel an order that has already been delivered`: the goods have
  been handed over.
- The order's state after the update would have it shipped or delivered
  without a successful payment. This also applies to payment-only changes:
  - `Cannot mark an order shipped|delivered before payment is successful`
    when the update changes delivery.
  - `Cannot set payment to pending|failed while the order is shipped|delivered`
    when only payment changes.
- `Cannot mark a cancelled order as paid`.
- The order fails a guard in `update-order`, and that guard's error message is
  used as the reason (`Cannot move a cancelled order back to an active delivery status`,
  `Cannot move a failed order back to pending or success — its stock has already been released`,
  or the 409 concurrency message above).

Updates go through the same service path as `update-order`. Stock is
restocked when an order moves into cancelled or failed, unless it was
already released. A delivery change sends the member the same
`delivery.status_changed` in-app/SMS notification as `update-delivery-status`.
A payment change sends no notification, the same as `update-order`.

Response 200:

```json
{
  "message": "Order statuses updated",
  "data": {
    "updated": [101, 103],
    "skipped": [{ "id": 102, "reason": "Cannot mark an order shipped before payment is successful" }]
  }
}
```

## GET `/orders/marketplace-overview` (protect + `can_view_marketplace`)

Query (both optional): `market_id`, `branch_id` (positive integers; otherwise 400
`market_id must be a positive integer` / `branch_id must be a positive integer`).
`branch_id` restricts the overview to markets with that `branch_id`. If both are
given, only markets that match both are used. Soft-deleted orders are excluded
everywhere. Dates use the server's timezone.

Response 200:

```json
{
  "message": "Marketplace overview retrieved successfully",
  "data": {
    "period": { "from": "2026-10-01", "to": "2026-10-31" },
    "revenue": 1250.5,
    "paid_orders": 18,
    "orders": 25,
    "cancelled": 2,
    "average_order": 69.47,
    "items_sold": 41,
    "to_fulfil": 6,
    "awaiting_payment": 4,
    "low_stock_variants": 3,
    "trend": [{ "date": "2026-10-05", "revenue": 0 }, { "date": "2026-10-18", "revenue": 220 }],
    "top_products": [
      {
        "product_id": 12,
        "name": "Conference T-shirt",
        "market_name": "Easter Market",
        "image_url": "https://...",
        "units": 30,
        "revenue": 1500
      }
    ]
  }
}
```

Field definitions:

- **Paid** means `payment_status = success` and `delivery_status != cancelled`.
- `period`: the current calendar month, first and last day (`YYYY-MM-DD`).
- `revenue`: for paid orders created in the period, the sum of
  `price_amount * quantity` over items in scope. Delivery fees are added only
  when the overview is unscoped, with neither `market_id` nor `branch_id`
  given. A fee belongs to the whole order, not to a market or branch.
- `paid_orders`, `orders`, `cancelled`: order counts in the period. `orders`
  counts every non-deleted order and `cancelled` counts those with
  `delivery_status = cancelled`. With a market or branch filter, an order counts
  if at least one of its items is in scope.
- `average_order`: `revenue / paid_orders`, or 0 when there are no paid orders.
- `items_sold`: units in scope across paid orders in the period.
- `to_fulfil`: all time, orders with `payment_status = success` and `delivery_status = pending`.
- `awaiting_payment`: all time, orders with `payment_status` `pending` or `failed`
  that are not cancelled.
- `low_stock_variants`: `product_stock` rows with `stock <= 3` whose product is
  published, not deleted, has `stock_managed != "no"`, and belongs to a
  non-deleted market that is active now (`start_date` null or in the past, and
  `end_date` null or in the future).
- `trend`: the last 14 days including today, oldest first. Days with no paid
  orders appear with revenue 0. Revenue uses the same rule as `revenue`.
- `top_products`: the top 5 products by units over all time. Only paid orders
  count, and only items whose market exists, is not deleted and has not ended.
  `image_url` is the first colour image if there is one, otherwise the product's
  `image_url`. `revenue` is the sum of `price_amount * quantity` for those items.

## Other behaviour fixes in this change

- `PUT /orders/update-delivery-status` with `cancelled` now restocks inside the
  same transaction, using the same claim pattern as `cancel-order`. Only the
  request that actually flips the order to cancelled restocks, and an order
  whose payment already failed is not restocked again. Both conditions are
  checked when the write happens, not from an earlier read. Cancelling a
  delivered order is rejected (400
  `Cannot cancel an order that has already been delivered`). Moving a cancelled
  order back to an active status is rejected (400
  `Cannot move a cancelled order back to an active delivery status`). That
  status write is also guarded, so a cancel that lands at the same moment is
  not silently reverted. Soft-deleted orders return `Order not found`.
- `GET /market/list-markets-by-event` and `GET /market/list-active-markets`
  (`getMarketsByEvent` / `getActiveMarkets`) now await their DTO conversion (`Promise.all`).
  Previously they returned unresolved promises.
