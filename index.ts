import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import * as dotenv from "dotenv";
import cors from "cors";
import { router } from "./src/routes/userRoutes";
import { memberrouter } from "./src/routes/memberRoutes";
import { attendanceRouter } from "./src/routes/attendanceRoute";
import { departmentRouter } from "./src/routes/departmentRoute";
import { positionRouter } from "./src/routes/positionRoute";
import { hashPassword } from "./src/utils/hashPasswords";
import { accessRouter } from "./src/routes/accessLevelRoute";
import { landingPage } from "./src/controllers/userController";
import { uploadRouter } from "./src/routes/uploadRoute";
dotenv.config();

// router
const userRoutes = router;

const port = process.env.PORT;
const MONGO_URI: any = process.env.MONGO_URI;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
app.get("/", landingPage);
app.use("/user", userRoutes);
app.use("/member", memberrouter);
app.use("/attendance", attendanceRouter);
app.use("/department", departmentRouter);
app.use("/position", positionRouter);
app.use("/access", accessRouter);
app.use("/upload", uploadRouter);

// mongoose
//   .connect(MONGO_URI, {})
//   .then(() => {
// console.log("Connected to MongoDB");
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// })
// .catch((error) => console.error("Failed to connect to MongoDB:", error))
