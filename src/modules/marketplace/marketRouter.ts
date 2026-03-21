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
marketRouter.get("/list-markets", [protect], marketController.listMarkets);
marketRouter.get(
  "/list-markets-by-event",
  [protect],
  marketController.listMarketsByEventId,
);
marketRouter.get("/get-market-count", [protect], marketController.getMarketCount);
marketRouter.get("/list-active-markets", [protect], marketController.getActiveMarkets);
marketRouter.get("/get-market-by-id", [protect], marketController.getMarketById);

export default marketRouter;
