import "express-async-errors";
import express from "express";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
import client from "prom-client";
import { logRequests } from "./src/middleWare/requestLogger";
import { responseMessageEnhancer } from "./src/middleWare/responseMessageEnhancer";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./src/middleWare/errorHandler";
dotenv.config();

const shouldRunBackgroundJobs = !["false", "0", "no"].includes(
  String(process.env.RUN_BACKGROUND_JOBS ?? "true")
    .trim()
    .toLowerCase(),
);

if (shouldRunBackgroundJobs) {
  require("./src/cron-jobs/hubtelPaymentReconciliationCron");
  require("./src/cron-jobs/requisitionNotificationCron");
  require("./src/cron-jobs/followUpNotificationCron");
  require("./src/cron-jobs/notificationRetentionCron");
  require("./src/cron-jobs/notificationPushRetryCron");
  require("./src/cron-jobs/notificationSmsRetryCron");
  require("./src/cron-jobs/eventReminderCron");
} else {
  logger.info("Background cron jobs are disabled for this process.");
}

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const swaggerOptions = require("./src/swagger");

const port = process.env.PORT;
const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(logRequests);
app.use(responseMessageEnhancer);
app.use(appRouter);

const specs = swaggerJsdoc(swaggerOptions);

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(specs, { explorer: true }),
);

// Expose metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

const server = app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      `Port ${port} is already in use. Stop the existing process and try again.`,
    );
  } else {
    logger.error(`Server failed to start: ${err.message}`);
  }
  process.exit(1);
});
