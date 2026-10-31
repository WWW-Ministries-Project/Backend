/**
 * Messaging actions and audience scope for the caller (see
 * src/permissions/catalog.ts). Routes run a Messaging guard first, which sets
 * `req.access`; actions follow the same branch rule as `requireAction` (with
 * no branch active, every branch role must allow it).
 */
import { Request } from "express";
import {
  getRequestAccess,
  userHasAction,
  userHasBranchDomainPermission,
} from "../../middleWare/authorization";
import { domainScope, isLegacyRole, scopeDepartmentIds } from "../../permissions/access";
import { UnauthorizedError } from "../../utils/custom-error-handlers";
import { getBranchScope } from "../branches/branchScope";
import { departmentMemberIds } from "../community/communityQueries";
import { Audience, Channels } from "./types";

export const MESSAGING_ACTIONS = [
  "send_in_app",
  "send_email",
  "send_sms",
  "schedule",
  "include_visitors",
  "view_recipient_contacts",
  "retry_paid",
  "edit_templates",
  "toggle_automatic",
] as const;
export type MessagingAction = (typeof MESSAGING_ACTIONS)[number];

/** Full-level actions that Manage gave before actions existed. */
const MANAGE_BEFORE_ACTIONS = new Set<MessagingAction>(["edit_templates", "toggle_automatic"]);

export type MessagingAccess = {
  userId: number;
  actions: Record<MessagingAction, boolean>;
  /** Departments the caller may message; null means the whole church. */
  departmentIds: number[] | null;
};

export const resolveMessagingAccess = async (req: Request): Promise<MessagingAccess> => {
  const access = getRequestAccess(req);
  if (!access?.isPrivilegedUser) throw new UnauthorizedError("Not authorized to manage messaging");
  const branchId = getBranchScope()?.activeBranchId ?? null;
  const legacyManage =
    isLegacyRole(access.permissions) &&
    (await userHasBranchDomainPermission(access.userId, "Messaging", "manage", branchId));
  const entries = await Promise.all(
    MESSAGING_ACTIONS.map(async (action) => {
      const allowed =
        (await userHasAction(access.userId, "Messaging", action, branchId)) ||
        (legacyManage && MANAGE_BEFORE_ACTIONS.has(action));
      return [action, allowed] as const;
    }),
  );
  return {
    userId: access.userId,
    actions: Object.fromEntries(entries) as Record<MessagingAction, boolean>,
    departmentIds: scopeDepartmentIds(domainScope(access.permissions, "Messaging"), access),
  };
};

const ACTION_LABEL: Record<MessagingAction, string> = {
  send_in_app: "send in-app messages",
  send_email: "send email",
  send_sms: "send SMS",
  schedule: "schedule messages",
  include_visitors: "message visitors",
  view_recipient_contacts: "see recipients' contact details",
  retry_paid: "retry failed SMS",
  edit_templates: "edit message templates",
  toggle_automatic: "turn automatic messages on or off",
};

export const assertMessagingAction = (access: MessagingAccess, action: MessagingAction) => {
  if (!access.actions[action]) {
    throw new UnauthorizedError(`Your role can't ${ACTION_LABEL[action]}`);
  }
};

/** Every channel switched on needs its send action. */
export const assertChannelsAllowed = (access: MessagingAccess, channels: Channels) => {
  if (channels.sms) assertMessagingAction(access, "send_sms");
  if (channels.email) assertMessagingAction(access, "send_email");
  if (channels.inApp) assertMessagingAction(access, "send_in_app");
};

/**
 * Visitors need include_visitors; a department-scoped role may only message
 * the departments it leads (and people in them), never the whole church.
 */
export const assertAudienceAllowed = async (access: MessagingAccess, audience: Audience) => {
  if (audience.includeVisitors) assertMessagingAction(access, "include_visitors");
  const allowed = access.departmentIds;
  if (!allowed) return;
  const outside = "Your role can only message the departments you lead";
  if (audience.scope === "CHURCH") throw new UnauthorizedError(outside);
  if (audience.scope === "DEPARTMENTS") {
    if (audience.departmentIds.some((id) => !allowed.includes(id))) {
      throw new UnauthorizedError(outside);
    }
    return;
  }
  const members = new Set(Array.from((await departmentMemberIds(allowed)).values()).flat());
  if (audience.userIds.some((id) => !members.has(id))) throw new UnauthorizedError(outside);
};

/** Which failed recipients a retry may requeue: SMS costs money (retry_paid). */
export const retryableChannels = (access: MessagingAccess): ("SMS" | "EMAIL" | "IN_APP")[] => [
  ...(access.actions.retry_paid ? (["SMS"] as const) : []),
  ...(access.actions.send_email ? (["EMAIL"] as const) : []),
  ...(access.actions.send_in_app ? (["IN_APP"] as const) : []),
];
