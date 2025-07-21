import {Router} from "express";
import {Permissions} from "../../middleWare/authorization";
import {MarketController} from "./marketController";

const permissions: Permissions = new Permissions();
const protect = permissions.protect;

const marketRouter = Router();
const marketController = new MarketController();

marketRouter.post("/create-market", marketController.createMarket);
marketRouter.put("/update-market", marketController.updateMarket);
marketRouter.delete("/delete-market", marketController.deleteMarket);
marketRouter.put("/restore-market", marketController.restoreMarket);
marketRouter.get("/list-markets", marketController.listMarkets);
marketRouter.get("/list-markets-by-event", marketController.listMarketsByEventId);
marketRouter.get("/get-market-count", marketController.getMarketCount);
marketRouter.get("/list-active-markets", marketController.getActiveMarkets);
marketRouter.get("/get-market-by-id", marketController.getMarketById);

export default marketRouter;