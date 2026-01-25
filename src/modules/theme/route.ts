import { Router } from "express";
import { AnnualThemeController } from "./controller";

const themeRouter = Router();
const controller = new AnnualThemeController();

themeRouter.post("/create-theme", controller.create);
themeRouter.get("/get-themes", controller.findAll);
themeRouter.get("/get-active-theme", controller.findActive);
themeRouter.get("/get-theme", controller.findById);    
themeRouter.put("/update-theme", controller.update);       
themeRouter.delete("/delete-theme", controller.delete);       

export default themeRouter;
