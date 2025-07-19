import {Router} from "express";
import {Permissions} from "../../middleWare/authorization";
import {MarketController} from "./marketController";

const permissions: Permissions = new Permissions();
const protect = permissions.protect;

const marketRouter = Router();
const marketController = new MarketController();

marketRouter.post("/", marketController.createMarket);
marketRouter.put("/:id", marketController.updateMarket);
marketRouter.delete("/:id", marketController.deleteMarket);
marketRouter.put("/restore/:id", marketController.restoreMarket);
marketRouter.get("/list", marketController.listMarkets);
marketRouter.get("/list-by-event/:eventId", marketController.listMarketsByEventId);
marketRouter.get("/count", marketController.getMarketCount);
marketRouter.get("/active", marketController.getActiveMarkets);
marketRouter.get("/:marketId", marketController.getMarketById);

export default marketRouter;