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
} from "../controllers/userController";
import { Permissions } from "../middleWare/authorization";
const permissions = new Permissions();
const protect = permissions.protect;
dotenv.config();

export const router = Router();

router.get("/get-user", getUser);

router.get("/list-users", [protect, permissions.can_view_users], ListUsers);

router.get("/stats-users", [protect], statsUsers);

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
router.post("/update-user", [protect, permissions.edit_Members], updateUser);

router.patch(
  "/update-user-status",
  [protect, permissions.edit_Members],
  updateUserSatus
);
router.delete(
  "/delete-user",
  [protect, permissions.delete_Members],
  deleteUser
);

router.get("/", landingPage);
