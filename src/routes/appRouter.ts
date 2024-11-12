import Router from "express";
import * as dotenv from "dotenv";
import {
  departmentRouter,
  positionRouter,
  accessRouter,
  landingPage,
  uploadRouter,
  assetRouter,
  eventRouter,
  requisitionRouter,
} from "../modules";


dotenv.config();
// router
export const appRouter = Router();

appRouter.get("/", landingPage);
appRouter.use("/department", departmentRouter);
appRouter.use("/position", positionRouter);
appRouter.use("/access", accessRouter);
appRouter.use("/upload", uploadRouter);
appRouter.use("/assets", assetRouter);
appRouter.use("/event", eventRouter);
appRouter.use("/requisitions", requisitionRouter);
