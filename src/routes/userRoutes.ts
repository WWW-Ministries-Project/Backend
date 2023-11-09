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
import { can_view_users, can_manage_users, protect } from "../middleWare/authorization";
dotenv.config();

export const router = Router();

router.get("/get-user", getUser);

router.get("/list-users", [protect, can_view_users], ListUsers);

router.post("/seed-user", seedUser);

router.post("/reset-password", resetPassword);

router.post("/forgot-password", forgetPassword);

router.post("/change-password", changePassword);

router.post("/login", login);

router.post("/register", [protect, can_manage_users], registerUser);

router.get("/", landingPage);
