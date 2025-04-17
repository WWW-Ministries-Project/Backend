import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
import { setupSwagger } from "./src/swagger";
import { prisma } from "./src/Models/context";
dotenv.config();
// import { startUserSyncing } from "./src/cron-jobs/userCron";


const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
setupSwagger(app);
app.use(appRouter);

async function startServer() {
  try {
    await prisma.$connect();
    console.log('✅ Successfully connected to the database');

    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
    
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    process.exit(1); // Exit the app with failure
  }
}

startServer();
