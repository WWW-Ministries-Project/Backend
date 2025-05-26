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
  getUserByEmailPhone,
  convertMemeberToConfirmedMember,
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

userRouter.post("/register", registerUser);
userRouter.put(
  "/update-user",
  [protect, permissions.can_Manage_Members],
  updateUser,
);

userRouter.put(
  "/update-user-status",
  [protect, permissions.can_Manage_Members],
  updateUserSatus,
);
userRouter.delete(
  "/delete-user",
  [protect, permissions.can_delete_users],
  deleteUser,
);
userRouter.put(
  "/activate-user",
  [protect, permissions.can_Manage_Members],
  activateUser,
);
userRouter.get("/get-user-email", getUserByEmailPhone);

userRouter.get("/", landingPage);

userRouter.put(
  "/update-member-status",
  [protect, permissions.can_Manage_Members],
  convertMemeberToConfirmedMember,
);
