-- Data-only backfill, no schema change.
--
-- order_items.product_colour_id (added 20260803120000_add_stock_reservation_and_notify)
-- is only ever set by checkout going forward, so every order_item created
-- before that column existed — or before checkout started populating it —
-- is stuck at NULL and can't resolve a colour_name via join
-- (see orderService.flattenOrders).
--
-- This matches each such item's snapshotted hex (`color`) against its own
-- product's current colour catalog (`product_colour.colour`, same
-- `product_id`) and links it permanently. Complements, not replaces, the
-- read-time hex-match fallback in flattenOrders — this makes the join
-- permanent instead of recomputed on every request, and also covers
-- read paths (findOne/findByUserId/findOneByMarketplaceId) that already
-- join `product_colour` directly and never had the read-time fallback.
--
-- Idempotent: only touches rows where product_colour_id IS NULL, safe to
-- run more than once.
--
-- Known gaps this cannot close (left NULL, same as today):
--   * order_items.product_id IS NULL (product hard-deleted since the order)
--   * the product's colour catalog no longer has that exact hex (swatch
--     edited/removed since the order was placed)
--   * the hex string itself doesn't match byte-for-byte (e.g. "#fff" vs
--     "#ffffff") — no normalization is attempted here
-- In all of these the row is unresolvable from data we still have; the
-- export will keep showing the raw hex for them, same as it does now.
UPDATE order_items oi
JOIN product_colour pc
  ON pc.product_id = oi.product_id
 AND pc.colour = oi.color
SET oi.product_colour_id = pc.id
WHERE oi.product_colour_id IS NULL
  AND oi.product_id IS NOT NULL;
