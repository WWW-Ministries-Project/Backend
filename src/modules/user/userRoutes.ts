import Router from "express";
import * as dotenv from "dotenv";
import {
  ListUsers,
  changePassword,
  deleteUser,
  forgetPassword,
  getUser,
  landingPage,
  login,
  registerUser,
  resetPassword,
  seedUser,
  updateUser,
  updateUserSatus,
  statsUsers,
  activateUser,
} from "../user/userController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const userRouter = Router();

userRouter.get("/get-user", getUser);

userRouter.get("/list-users", ListUsers);

userRouter.get("/stats-users", [protect], statsUsers);

userRouter.post("/seed-user", seedUser);

userRouter.post("/reset-password", resetPassword);

userRouter.post("/forgot-password", forgetPassword);

userRouter.post("/change-password", changePassword);

userRouter.post("/login", login);

userRouter.post(
  "/register",
  [protect, permissions.can_Manage_Members],
  registerUser
);
userRouter.post(
  "/update-user",
  [protect, permissions.can_Manage_Members],
  updateUser,
);

userRouter.patch(
  "/update-user-status",
  [protect, permissions.can_Manage_Members],
  updateUserSatus,
);
userRouter.delete(
  "/delete-user",
  [protect, permissions.can_Manage_Members],
  deleteUser,
);
userRouter.put(
  "/activate-user",
  [protect, permissions.can_Manage_Members],
  activateUser,
);

userRouter.get("/", landingPage);
