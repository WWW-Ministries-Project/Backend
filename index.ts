import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import * as dotenv from "dotenv";
import cors from "cors";
import { router } from "./src/routes/userRoutes";
import { memberrouter } from "./src/routes/memberRoutes";
import { attendanceRouter } from "./src/routes/attendanceRoute";
dotenv.config();

// router
const userRoutes = router;

const port = process.env.PORT;
const MONGO_URI: any = process.env.MONGO_URI;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
app.use("/user", userRoutes);
app.use("/member", memberrouter);
app.use("/attendance", attendanceRouter);

mongoose
  .connect(MONGO_URI, {})
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(8000, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((error) => console.error("Failed to connect to MongoDB:", error));
