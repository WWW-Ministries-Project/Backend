import { Router } from "express";
import { MarketController } from "./marketController";
import { Permissions } from "../../middleWare/authorization";

const marketRouter = Router();
const marketController = new MarketController();
const permissions = new Permissions();
const protect = permissions.protect;

marketRouter.post(
  "/create-market",
  [protect, permissions.can_manage_marketplace],
  marketController.createMarket,
);
marketRouter.post(
  "/duplicate-market",
  [protect, permissions.can_manage_marketplace],
  marketController.duplicateMarket,
);
marketRouter.put(
  "/update-market",
  [protect, permissions.can_manage_marketplace],
  marketController.updateMarket,
);
marketRouter.delete(
  "/delete-market",
  [protect, permissions.can_delete_marketplace],
  marketController.deleteMarket,
);
marketRouter.put(
  "/restore-market",
  [protect, permissions.can_manage_marketplace],
  marketController.restoreMarket,
);
// Public storefront read: guests browsing /out/products fetch markets for the
// filter bar with no token. Scoping comes from an explicit branch_id query
// param, not req.user — see marketService.getAllMarkets.
marketRouter.get("/list-markets", marketController.listMarkets);
marketRouter.get(
  "/list-markets-by-event",
  [protect],
  marketController.listMarketsByEventId,
);
marketRouter.get("/get-market-count", [protect], marketController.getMarketCount);
marketRouter.get("/list-active-markets", [protect], marketController.getActiveMarkets);
marketRouter.get("/get-market-by-id", [protect], marketController.getMarketById);

export default marketRouter;
