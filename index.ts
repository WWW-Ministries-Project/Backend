import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
import { setupSwagger } from "./src/swagger";
dotenv.config();
// import { startUserSyncing } from "./src/cron-jobs/userCron";


const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
setupSwagger(app);
app.use(appRouter);

// startUserSyncing();

// mongoose//   .connect(MONGO_URI, {})
//   .then(() => {
// console.log("Connected to MongoDB");
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
