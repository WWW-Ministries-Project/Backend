import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { MarketController } from "./marketController";

const permissions: Permissions = new Permissions();
const protect = permissions.protect;

const marketRouter = Router();
const marketController = new MarketController();

marketRouter.post("/create-market", marketController.createMarket);

export default marketRouter;