import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
dotenv.config();
import { startUserSyncing } from "./src/cron-jobs/userCron";
import { syncDepartments } from "./src/cron-jobs/departmentCron";
import { syncPositions } from "./src/cron-jobs/positionCron";

const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
app.use(appRouter);

// mongoose//   .connect(MONGO_URI, {})
//   .then(() => {
// console.log("Connected to MongoDB");
startUserSyncing();
syncDepartments();
syncPositions();

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
