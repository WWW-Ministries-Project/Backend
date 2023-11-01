import Router from "express";
import * as dotenv from "dotenv";
import {
  ListUsers,
  changePassword,
  forgetPassword,
  getUser,
  landingPage,
  login,
  registerUser,
  resetPassword,
  seedUser,
} from "../controllers/userController";
dotenv.config();
export const router = Router();

router.get("/getUser", getUser);

router.get("/listUsers", ListUsers);

router.post("/seed-user", seedUser);

router.post("/reset-password", resetPassword);

router.post("/forgot-password", forgetPassword);

router.post("/change-password", changePassword);

router.post("/login", login);

router.post("/register", registerUser);

router.get("/", landingPage);
