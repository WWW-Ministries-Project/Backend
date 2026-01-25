import { Router } from "express";
import { FinancialsController } from "./controller";

const financialRouter = Router();
const controller = new FinancialsController();

financialRouter.post("/create-financial-data", controller.create);
financialRouter.get("/get-empty-financial-data", controller.fetchEmptyFinancialData);
financialRouter.get("/get-financial-data", controller.findAll);
financialRouter.get("/get-financial-data-byId", controller.findById);
financialRouter.put("/update-financial-data", controller.update);
financialRouter.delete("/delete-financial-data", controller.delete);

export default financialRouter;
