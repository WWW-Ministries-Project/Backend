import Router from "express";
import * as dotenv from "dotenv";
import { listDirectoryDepartments, listMemberDirectory } from "./memberDirectoryController";
import {
  ListUsers,
  changePassword,
  deleteUser,
  deleteOwnAccount,
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
  bulkUpdateMemberStatus,
  bulkUpdateUserStatus,
  linkSpouses,
  getUserFamily,
  linkChildren,
  currentuser,
  getMemberProfileStats,
  ListUsersLight,
  activateAccount,
  updateUserPasswordToDefault,
  sendEmailToAllUsers,
  filterUsersInfo,
} from "../user/userController";
import {
  approveMembershipRequest,
  createMembershipRequest,
  declineMembershipRequest,
  getMyMembershipRequest,
  listGuests,
  listMembershipRequests,
  selfRegister,
  updateMyProfile,
} from "./selfServiceController";
import { Permissions } from "../../middleWare/authorization";
import { authRateLimiter } from "../../middleWare/authRateLimiter";
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
  [protect],
  ListUsersLight,
);

// Member-facing directory: name + where someone serves, no contact details.
userRouter.get("/directory", [protect], listMemberDirectory);
userRouter.get("/directory/departments", [protect], listDirectoryDepartments);

userRouter.get(
  "/search-users",
  [protect, permissions.can_view_member_details],
  filterUsersInfo,
);

userRouter.get("/stats-users", [protect], statsUsers);

userRouter.post("/seed-user", [protect, permissions.can_delete_users], seedUser);

userRouter.post("/reset-password", [authRateLimiter], resetPassword);

userRouter.post("/forgot-password", [authRateLimiter], forgetPassword);

userRouter.post("/change-password", [authRateLimiter, protect], changePassword);

userRouter.post("/login", [authRateLimiter], login);

userRouter.post("/register", [authRateLimiter], registerUser);

// Mobile self-service. Self-registration is public (rate limited) and fixes
// every privileged field server-side; see selfServiceController.
userRouter.post("/self-register", [authRateLimiter], selfRegister);
userRouter.put("/me/profile", [protect], updateMyProfile);
userRouter.post("/membership-request", [protect], createMembershipRequest);
userRouter.get("/membership-request/mine", [protect], getMyMembershipRequest);

// Dashboard: Visitors > Guests, and Membership management > Guest to membership.
userRouter.get("/guests", [protect, permissions.can_view_visitors_scoped], listGuests);
userRouter.get(
  "/membership-requests",
  [protect, permissions.can_manage_member_details],
  listMembershipRequests,
);
userRouter.patch(
  "/membership-requests/approve",
  [protect, permissions.can_manage_member_details],
  approveMembershipRequest,
);
userRouter.patch(
  "/membership-requests/decline",
  [protect, permissions.can_manage_member_details],
  declineMembershipRequest,
);
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

userRouter.delete("/delete-account", [protect], deleteOwnAccount);

userRouter.put(
  "/activate-account",
  [protect, permissions.can_manage_member_details],
  activateAccount,
);
userRouter.get(
  "/get-user-email",
  [protect, permissions.can_view_member_details],
  getUserByEmailPhone,
);

userRouter.get("/", landingPage);

userRouter.put(
  "/update-member-status",
  [protect, permissions.can_manage_member_details],
  convertMemeberToConfirmedMember,
);

userRouter.post(
  "/update-member-status/bulk",
  [protect, permissions.can_manage_member_details],
  bulkUpdateMemberStatus,
);

userRouter.post(
  "/update-user-status/bulk",
  [protect, permissions.can_manage_member_details],
  bulkUpdateUserStatus,
);

userRouter.put(
  "/link-spouses",
  [protect, permissions.can_manage_member_details],
  linkSpouses,
);

userRouter.get(
  "/get-user-family",
  [protect, permissions.can_view_member_details],
  getUserFamily,
);

userRouter.put(
  "/link-children",
  [protect, permissions.can_manage_member_details],
  linkChildren,
);

userRouter.get("/current-user", [protect], currentuser);

userRouter.get("/profile-stats", [protect], getMemberProfileStats);

userRouter.get(
  "/set-default-passwords",
  [protect, permissions.can_delete_member_details],
  updateUserPasswordToDefault,
);

userRouter.post(
  "/send-emails-to-user",
  [protect, permissions.can_manage_member_details],
  sendEmailToAllUsers,
);
