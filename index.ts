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

// Expose metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
