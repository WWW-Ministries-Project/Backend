import { Router } from "express";
import { Permissions } from "../../middleWare/authorization";
import { getLiveStreamStatus } from "./liveStreamController";

const liveStreamRouter = Router();
const permissions = new Permissions();
const protect = permissions.protect;

// Any signed-in account (member or guest) may see whether the church is live.
liveStreamRouter.get("/status", [protect], getLiveStreamStatus);

export default liveStreamRouter;
