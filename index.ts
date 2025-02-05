import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
import logger from "./src/utils/logger-config";
dotenv.config();


const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
app.use(appRouter);



// mongoose//   .connect(MONGO_URI, {})
//   .then(() => {
// console.log("Connected to MongoDB");
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
