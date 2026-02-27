import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
import client from "prom-client";
import { logRequests } from "./src/middleWare/requestLogger";
import { responseMessageEnhancer } from "./src/middleWare/responseMessageEnhancer";
import "./src/cron-jobs/hubtelPaymentReconciliationCron";
dotenv.config();
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const swaggerOptions = require("./src/swagger");

const port = process.env.PORT;
const app = express();
const corsAllowedOrigins = Array.from(
  new Set(
    [
      ...(process.env.CORS_ORIGINS || "").split(","),
      process.env.Frontend_URL || "",
    ]
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
);
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (!corsAllowedOrigins.length) {
        return isProduction
          ? callback(new Error("CORS origin denied"))
          : callback(null, true);
      }

      if (corsAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin denied"));
    },
  }),
);
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));
app.use(responseMessageEnhancer);
app.use(appRouter);
app.use(logRequests);

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

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
