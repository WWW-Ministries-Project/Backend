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
import { Permissions } from "../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const router = Router();

router.get("/get-user", getUser);

router.get("/list-users", [protect, permissions.can_view_users], ListUsers);

router.post("/seed-user", seedUser);

router.post("/reset-password", resetPassword);

router.post("/forgot-password", forgetPassword);

router.post("/change-password", changePassword);

router.post("/login", login);

router.post(
  "/register",
  [protect, permissions.can_create_Members],
  registerUser
);

router.get("/", landingPage);
