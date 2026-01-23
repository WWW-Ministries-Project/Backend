import { Router } from "express";
import { ReceiptConfigController } from "./controller";

const receiptConfigRouter = Router();
const controller = new ReceiptConfigController();

receiptConfigRouter.post("/", controller.create.bind(controller));
receiptConfigRouter.get("/", controller.findAll.bind(controller));
receiptConfigRouter.get("/:id", controller.findById.bind(controller));
receiptConfigRouter.put("/:id", controller.update.bind(controller));
receiptConfigRouter.delete("/:id", controller.delete.bind(controller));

export default receiptConfigRouter;