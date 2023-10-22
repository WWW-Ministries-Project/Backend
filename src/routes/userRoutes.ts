import Router from "express";
import * as dotenv from "dotenv";
import {
  changePassword,
  forgetPassword,
  landingPage,
  login,
  registerUser,
  resetPassword,
  seedUser,
} from "../controllers/userController";
dotenv.config();
export const router = Router();

router.post("/seed-user", seedUser);

router.post("/reset-password", resetPassword);

router.post("/forgot-password", forgetPassword);

router.post("/change-password", changePassword);

router.post("/login", login);

router.post("/register", registerUser);

router.get("/", landingPage);
