import express from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import cors from "cors";
import { router } from "./src/routes/userRoutes";
import { departmentRouter } from "./src/routes/departmentRoute";
import { positionRouter } from "./src/routes/positionRoute";
import { accessRouter } from "./src/routes/accessLevelRoute";
import { landingPage } from "./src/controllers/userController";
import { uploadRouter } from "./src/routes/uploadRoute";
import { assetRouter } from "./src/routes/assetRouter";
import { eventRouter } from "./src/routes/eventRoute";
import { requisitionRouter } from "./src/controllers/requisitions/requisitionRoute";
dotenv.config();
// router
const userRoutes = router;

const port = process.env.PORT;
const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());
app.get("/", landingPage);
app.use("/user", userRoutes);
app.use("/department", departmentRouter);
app.use("/position", positionRouter);
app.use("/access", accessRouter);
app.use("/upload", uploadRouter);
app.use("/assets", assetRouter);
app.use("/event", eventRouter);
app.use("/requisitions", requisitionRouter);

// mongoose
//   .connect(MONGO_URI, {})
//   .then(() => {
// console.log("Connected to MongoDB");
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// })
// .catch((error) => console.error("Failed to connect to MongoDB:", error))
