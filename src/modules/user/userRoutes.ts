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
  updateUserPasswordToDefault,
  sendEmailToAllUsers,
  filterUsersInfo,
} from "../user/userController";
import { Permissions } from "../../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const userRouter = Router();

userRouter.get("/get-user", [protect, permissions.can_view_member_details], getUser);

userRouter.get(
  "/list-users",
  [protect, permissions.can_view_member_details],
  ListUsers,
);

userRouter.get(
  "/list-users-light",
  [protect, permissions.can_view_member_details],
  ListUsersLight,
);

userRouter.get(
  "/search-users",
  [protect, permissions.can_view_member_details],
  filterUsersInfo,
);

userRouter.get("/stats-users", [protect], statsUsers);

userRouter.post("/seed-user", [protect, permissions.can_delete_users], seedUser);

userRouter.post("/reset-password", resetPassword);

userRouter.post("/forgot-password", forgetPassword);

userRouter.post("/change-password", changePassword);

userRouter.post("/login", login);

userRouter.post("/register", registerUser);
userRouter.put(
  "/update-user",
  [protect, permissions.can_manage_member_details],
  updateUser,
);

userRouter.put(
  "/update-user-status",
  [protect, permissions.can_manage_member_details],
  updateUserSatus,
);
userRouter.delete(
  "/delete-user",
  [protect, permissions.can_delete_member_details],
  deleteUser,
);
userRouter.put(
  "/activate-account",
  [protect, permissions.can_manage_member_details],
  activateAccount,
);
userRouter.get("/get-user-email", getUserByEmailPhone);

userRouter.get("/", landingPage);

userRouter.put(
  "/update-member-status",
  [protect, permissions.can_manage_member_details],
  convertMemeberToConfirmedMember,
);

userRouter.put(
  "/link-spouses",
  [protect, permissions.can_manage_member_details],
  linkSpouses,
);

userRouter.get("/get-user-family", getUserFamily);

userRouter.put(
  "/link-children",
  [protect, permissions.can_manage_member_details],
  linkChildren,
);

userRouter.get("/current-user", currentuser);

userRouter.get(
  "/set-default-passwords",
  [protect, permissions.can_delete_member_details],
  updateUserPasswordToDefault,
);

userRouter.post("/send-emails-to-user", sendEmailToAllUsers);
