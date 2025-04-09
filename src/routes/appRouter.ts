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
  userRouter,
} from "../modules";
import programRouter from "../modules/programs/programRoute";
import visitorRouter from "../modules/visitorManagement/visitorRoute"
import attendanceRouter from "../modules/attendance/attendanceRoute"

dotenv.config();
// router
export const appRouter = Router();

appRouter.get("/", landingPage);
appRouter.use("/user", userRouter);
appRouter.use("/department", departmentRouter);
appRouter.use("/position", positionRouter);
appRouter.use("/access", accessRouter);
appRouter.use("/upload", uploadRouter);
appRouter.use("/assets", assetRouter);
appRouter.use("/event", eventRouter);
appRouter.use("/requisitions", requisitionRouter);
appRouter.use("/program", programRouter);
appRouter.use("/visitor", visitorRouter);
appRouter.use("/attendance", attendanceRouter)
