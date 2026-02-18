import { Router } from "express";
import { ReceiptConfigController } from "./controller";

const receiptConfigRouter = Router();
const controller = new ReceiptConfigController();

receiptConfigRouter.post("/create-receipt-config", controller.create);
receiptConfigRouter.get("/get-receipt-configs", controller.findAll);
receiptConfigRouter.put("/update-receipt-config", controller.update);
receiptConfigRouter.delete("/delete-receipt-config", controller.delete);

export default receiptConfigRouter;
