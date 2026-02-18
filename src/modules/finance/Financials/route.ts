import { Router } from "express";
import { FinancialsController } from "./controller";

const financialsRouter = Router();
const controller = new FinancialsController();

financialsRouter.post("/create-financial", controller.create);
financialsRouter.get("/get-financials", controller.findAll);
financialsRouter.get("/get-financial", controller.findOne);
financialsRouter.put("/update-financial", controller.update);
financialsRouter.delete("/delete-financial", controller.delete);

export default financialsRouter;
