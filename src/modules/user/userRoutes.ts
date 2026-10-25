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
  publicRegisterMember,
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
  giveAccess,
  sendResetLink,
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
import { NextFunction, Request, Response } from "express";
import { getRequestAccess, hasActionPermission, Permissions } from "../../middleWare/authorization";
import { actionAllowed, isLegacyRole } from "../../permissions/access";
import { authRateLimiter } from "../../middleWare/authRateLimiter";
const permissions = new Permissions();
const protect = permissions.protect;

const sendEmailsGuard = (req: Request, res: Response, next: NextFunction) => {
  const access = getRequestAccess(req);
  const allowed =
    !!access?.isPrivilegedUser &&
    (actionAllowed(access.permissions, "Messaging", "send_email") ||
      (isLegacyRole(access.permissions) && hasActionPermission(access.permissions, "Members", "manage")));
  if (!allowed) {
    return res.status(403).json({ message: "Not authorized to send emails", data: null, code: "ACTION_FORBIDDEN" });
  }
  return next();
};
dotenv.config();

export const userRouter = Router();

userRouter.get("/get-user", [protect, permissions.can_view_member_details], getUser);

userRouter.get(
  "/list-users",
  [protect, permissions.can_view_member_details],
  ListUsers,
);

// Name pickers across the dashboard: staff only.
userRouter.get(
  "/list-users-light",
  [protect, permissions.requireStaff],
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

// Counts follow the caller's Members scope (req.access).
// Admin shell headline counts: staff only.
userRouter.get("/stats-users", [protect, permissions.requireStaff], statsUsers);

userRouter.post("/seed-user", [protect, permissions.can_delete_users], seedUser);

userRouter.post("/reset-password", [authRateLimiter], resetPassword);

userRouter.post("/forgot-password", [authRateLimiter], forgetPassword);

userRouter.post("/change-password", [authRateLimiter, protect], changePassword);

userRouter.post("/login", [authRateLimiter], login);

// Dashboard "Add member": places people in departments and positions, sets
// status and sign-in, and converts visitors and souls won.
userRouter.post(
  "/register",
  [authRateLimiter, protect, permissions.can_manage_member_details],
  registerUser,
);
// The public membership form: the person's own details only.
userRouter.post("/public-register", [authRateLimiter], publicRegisterMember);

// Mobile self-service. Self-registration is public (rate limited) and fixes
// every privileged field server-side; see selfServiceController.
userRouter.post("/self-register", [authRateLimiter], selfRegister);
userRouter.put("/me/profile", [protect], updateMyProfile);
userRouter.post("/membership-request", [protect], createMembershipRequest);
userRouter.get("/membership-request/mine", [protect], getMyMembershipRequest);

// Dashboard: Visitors > Guests, and Membership management > Guest to membership.
// Every guest's contact details: Visitors view on the whole branch, not the
// "visitors I'm responsible for" scope (listGuests doesn't apply that scope).
userRouter.get("/guests", [protect, permissions.can_view_visitors], listGuests);
// Membership management: looking at the pipeline is View; deciding is
// Manage. Roles saved before the domain existed resolve it through Members.
userRouter.get(
  "/membership-requests",
  [
    protect,
    permissions.requireAction(
      "Membership_Management",
      "view_pipelines",
      "Not authorized to view membership requests",
    ),
  ],
  listMembershipRequests,
);
userRouter.patch(
  "/membership-requests/approve",
  [
    protect,
    permissions.requireAction(
      "Membership_Management",
      "decide_guest_request",
      "Not authorized to decide membership requests",
    ),
  ],
  approveMembershipRequest,
);
userRouter.patch(
  "/membership-requests/decline",
  [
    protect,
    permissions.requireAction(
      "Membership_Management",
      "decide_guest_request",
      "Not authorized to decide membership requests",
    ),
  ],
  declineMembershipRequest,
);
userRouter.put(
  "/update-user",
  [protect, permissions.can_manage_member_details],
  updateUser,
);

// Access rights › Invite users (Manage by default, as before).
userRouter.post(
  "/give-access",
  [
    protect,
    permissions.requireAction("Access_rights", "invite_users", "Not authorized to invite users"),
  ],
  giveAccess,
);
// Members › Send password links or Access rights › Reset passwords, checked
// in the controller with the member's branch, scope and exclusions.
userRouter.post("/send-reset-link", [protect, permissions.withAccess], sendResetLink);
userRouter.put(
  "/update-user-status",
  [protect, permissions.can_manage_member_details],
  updateUserSatus,
);
// Members › Delete (Full by default), checked in the controller with the
// member's branch, scope and exclusions.
userRouter.delete("/delete-user", [protect, permissions.withAccess], deleteUser);

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

// Membership management › Confirm members (or Members › Change status),
// checked in the controller with each member's branch, scope and exclusions.
userRouter.put(
  "/update-member-status",
  [protect, permissions.withAccess],
  convertMemeberToConfirmedMember,
);

userRouter.post(
  "/update-member-status/bulk",
  [protect, permissions.withAccess],
  bulkUpdateMemberStatus,
);

// Members › Change status or Access rights › Deactivate users (the Users
// page), checked in the controller with each member's branch, scope and
// exclusions.
userRouter.post(
  "/update-user-status/bulk",
  [protect, permissions.withAccess],
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
  // Bulk email is a Messaging send; roles saved before actions keep the old
  // Members-manage rule.
  [protect, permissions.withAccess, sendEmailsGuard],
  sendEmailToAllUsers,
);
