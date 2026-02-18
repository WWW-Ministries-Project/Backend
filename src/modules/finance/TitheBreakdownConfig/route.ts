import { Router } from "express";
import { TitheBreakdownConfigController } from "./controller";

const titheBreakdownConfigRouter = Router();
const controller = new TitheBreakdownConfigController();

titheBreakdownConfigRouter.post(
  "/create-tithe-breakdown-config",
  controller.create,
);
titheBreakdownConfigRouter.get(
  "/get-tithe-breakdown-configs",
  controller.findAll,
);
titheBreakdownConfigRouter.put(
  "/update-tithe-breakdown-config",
  controller.update,
);
titheBreakdownConfigRouter.delete(
  "/delete-tithe-breakdown-config",
  controller.delete,
);

export default titheBreakdownConfigRouter;
