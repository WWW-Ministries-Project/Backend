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
  getUserByEmailPhone,
  convertMemeberToConfirmedMember,
  linkSpouses,
  getUserFamily,
  linkChildren,
  currentuser,
  ListUsersLight,
  activateAccount,
} from "../user/userController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const userRouter = Router();

userRouter.get("/get-user", getUser);

userRouter.get("/list-users", ListUsers);

userRouter.get("/list-users-light", ListUsersLight);

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
  "/activate-account",
  [protect, permissions.can_Manage_Members],
  activateAccount,
);
userRouter.get("/get-user-email", getUserByEmailPhone);

userRouter.get("/", landingPage);

userRouter.put(
  "/update-member-status",
  [protect, permissions.can_Manage_Members],
  convertMemeberToConfirmedMember,
);

userRouter.put(
  "/link-spouses",
  [protect, permissions.can_Manage_Members],
  linkSpouses,
);

userRouter.get(
  "/get-user-family",
  [protect, permissions.can_Manage_Members],
  getUserFamily,
);

userRouter.put(
  "/link-children",
  [protect, permissions.can_Manage_Members],
  linkChildren,
);

userRouter.get("/current-user", currentuser);
