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
import visitorRouter from "../modules/visitorManagement/visitorRoute";
import lifeCenterRouter from "../modules/lifeCenterMangement/lifeCenterRoute";
import deviceRouter from "../modules/devices/devicesRoute";
import marketRouter from "../modules/marketplace/marketRouter";
import productRouter from "../modules/products/productRouter";
import orderRouter from "../modules/orders/orderRoutes";
import themeRouter from "../modules/theme/route";
import appointmentRouter from "../modules/appointment/appointment-route";
import { fi } from "date-fns/locale";
// import receiptConfigRouter from "../modules/finance/ReceiptConfig/route";
// import bankAccountConfigRouter from "../modules/finance/BankAccountConfig/route";
// import paymentConfigRouter from "../modules/finance/PaymentConfig/route";
dotenv.config();

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
appRouter.use("/lifecenter", lifeCenterRouter);
appRouter.use("/device", deviceRouter);
appRouter.use("/market", marketRouter);
appRouter.use("/product", productRouter);
appRouter.use("/orders", orderRouter);
appRouter.use("/theme", themeRouter);
appRouter.use("/appointment", appointmentRouter);
// appRouter.use("/receiptconfig", receiptConfigRouter);
// appRouter.use("/paymentconfig", paymentConfigRouter);
// appRouter.use("/bankaccountconfig", bankAccountConfigRouter);

