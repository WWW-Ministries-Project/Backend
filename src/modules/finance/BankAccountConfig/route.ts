import { Router } from "express";
import { BankAccountConfigController } from "./controller";

const bankAccountConfigRouter = Router();
const controller = new BankAccountConfigController();

bankAccountConfigRouter.post("/create-bank-account-config", controller.create);
bankAccountConfigRouter.get("/get-bank-account-configs", controller.findAll);
bankAccountConfigRouter.put("/update-bank-account-config", controller.update);
bankAccountConfigRouter.delete("/delete-bank-account-config", controller.delete);

export default bankAccountConfigRouter;
