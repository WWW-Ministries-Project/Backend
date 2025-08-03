import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
import { setupSwagger } from "./src/swagger";
import client from "prom-client";
dotenv.config();
// import { startUserSyncing } from "./src/cron-jobs/userCron";
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
setupSwagger(app);
app.use(appRouter);

// startUserSyncing();
// Add this early in your main app file (before other imports)
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error) {
    console.error('Stack trace:', reason.stack);
  }
});

// Expose metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});