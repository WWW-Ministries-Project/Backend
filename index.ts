import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { appRouter } from "./src/routes/appRouter";
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
  console.log(`Server running on port ${port}`);
});
// })
// .catch((error) => console.error("Failed to connect to MongoDB:", error))
