/**
 * What each permission domain lets a role do beyond its level, and whose
 * records it can be limited to. A level switches on every action whose
 * default level it reaches; a role can switch actions on or off in
 * `permissions.Actions` and narrow its records in `permissions.Scopes`.
 *
 * Mirrors the Frontend's src/utils/permissionCatalog.ts (which adds the
 * labels shown in the role editor). Keys and default levels must agree.
 * Each action is [key, defaultLevel (1 View, 2 Manage, 3 Full), explicit?];
 * an explicit action is only ever on when a role switches it on.
 */

export type ScopeValue =
  | "own"
  | "assigned"
  | "department"
  | "department_member"
  | "life_center"
  | "branch";

export type CatalogAction = [key: string, defaultLevel: 1 | 2 | 3, explicit?: true];

export interface DomainCatalog {
  scopes: ScopeValue[];
  /** Scope a View-only role starts with; otherwise "branch". */
  viewScope?: ScopeValue;
  actions: CatalogAction[];
}

export const PERMISSION_CATALOG: Record<string, DomainCatalog> = {
  Reports: {
    scopes: ["department", "branch"],
    actions: [
      ["event_generate", 2],
      ["event_approve", 1],
      ["event_comment", 1],
      ["event_export", 1],
      ["dept_prepare", 2],
      ["dept_approve", 1],
      ["dept_remind", 2],
      ["dept_view_member_names", 2],
      ["dept_decide_request", 3],
      ["exec_view", 1],
      ["exec_decide", 3],
      ["event_configure_approvals", 3, true],
      ["configure", 3],
    ],
  },
  Members: {
    scopes: ["department", "life_center", "branch"],
    actions: [
      ["view_contact_details", 1],
      ["create", 2],
      ["edit", 2],
      ["change_status", 2],
      ["link_family", 2],
      ["send_password_link", 2],
      ["export", 2],
      ["grant_login", 3],
      ["delete", 3],
    ],
  },
  Membership_Management: {
    scopes: ["department", "branch"],
    actions: [
      ["view_pipelines", 1],
      ["confirm_member", 2],
      ["decide_guest_request", 2],
      ["decide_join_request", 2],
      ["convert_visitor", 2],
      ["convert_soul", 2],
    ],
  },
  Visitors: {
    scopes: ["assigned", "branch"],
    viewScope: "assigned",
    actions: [
      ["record_follow_up", 1],
      ["log_visit", 2],
      ["assign_responsible", 2],
      ["manage_prayer_requests", 2],
      ["convert_to_member", 2],
      ["export", 2],
      ["delete", 3],
    ],
  },
  "Life Center": {
    scopes: ["life_center", "branch"],
    viewScope: "life_center",
    actions: [
      ["record_souls", 2],
      ["record_meeting", 2],
      ["export", 2],
      ["assign_members", 2],
      ["assign_leader", 2],
      ["remind_leader", 2],
      ["manage_roles", 3],
      ["delete", 3],
    ],
  },
  Church_Attendance: {
    scopes: ["department", "branch"],
    actions: [
      ["record", 2],
      ["record_official", 2],
      ["edit_past", 2],
      ["import_biometric", 2],
      ["export", 2],
      ["manage_devices", 3],
      ["configure_timing", 3],
      ["delete", 3],
    ],
  },
  Rides: {
    scopes: ["branch"],
    actions: [
      ["view_overview", 1],
      ["cancel_any_offer", 2],
      ["manage_pickup_points", 2],
      ["resolve_safety_reports", 2, true],
      ["lift_block", 2, true],
      ["export_roster", 2, true],
    ],
  },
  Departments: {
    scopes: ["department", "branch"],
    actions: [
      ["create", 2],
      ["edit", 2],
      ["manage_members", 2],
      ["assign_positions", 2],
      ["assign_head", 3],
      ["delete", 3],
    ],
  },
  Events: {
    scopes: ["branch"],
    actions: [
      ["view_registrations", 1],
      ["create", 2],
      ["edit", 2],
      ["manage_series", 2],
      ["manage_online_links", 2],
      ["send_reminders", 2],
      ["check_in", 2],
      ["export_registrants", 2],
      ["manage_types", 3],
      ["delete", 3],
    ],
  },
  Appointments: {
    scopes: ["own", "branch"],
    viewScope: "own",
    actions: [
      ["respond", 1],
      ["complete", 1],
      ["manage_own_availability", 1],
      ["book_for_others", 2],
      ["cancel_any", 2],
      ["reassign", 2],
      ["send_reminders", 2],
      ["manage_others_availability", 2],
      ["export", 2],
      ["configure", 3],
      ["delete", 3],
    ],
  },
  School_of_ministry: {
    scopes: ["assigned", "branch"],
    viewScope: "assigned",
    actions: [
      ["view_reports", 1],
      ["grade", 1],
      ["take_attendance", 1],
      ["manage_assignments", 1],
      ["announce", 1],
      ["design_curriculum", 2],
      ["manage_cohorts", 2],
      ["enroll_others", 2],
      ["decide_applications", 2],
      ["edit_progress", 2],
      ["issue_certificates", 3],
      ["manage_instructors", 3],
      ["delete", 3],
    ],
  },
  Theme: {
    scopes: ["branch"],
    actions: [
      ["edit", 2],
      ["publish", 2],
    ],
  },
  Community: {
    scopes: ["department", "branch"],
    actions: [
      ["post_church_wide", 2],
      ["post_any_department", 2],
      ["pin_important", 2],
      ["moderate", 2],
      ["view_audit_log", 3],
      ["delete_any", 3],
      ["view_anonymous_author", 3, true],
    ],
  },
  Sermons: {
    scopes: ["branch"],
    actions: [
      ["view_drafts", 1],
      ["create", 2],
      ["publish", 2],
      ["manage_series", 2],
      ["delete", 3],
    ],
  },
  Promotions: {
    scopes: ["branch"],
    actions: [
      ["create", 2],
      ["publish", 2],
      ["archive", 2],
      ["reorder", 2],
      ["delete", 3],
    ],
  },
  Messaging: {
    scopes: ["department", "branch"],
    actions: [
      ["send_in_app", 2],
      ["send_email", 2],
      ["schedule", 2],
      ["include_visitors", 2],
      ["view_recipient_contacts", 2],
      ["send_sms", 2, true],
      ["retry_paid", 2, true],
      ["edit_templates", 3],
      ["toggle_automatic", 3],
      ["approve_sms", 3, true],
    ],
  },
  Financials: {
    scopes: ["branch"],
    actions: [
      ["approve", 1],
      ["create_draft", 2],
      ["submit", 2],
      ["export", 2],
      ["configure", 3],
      ["delete", 3],
      ["edit_approved", 3, true],
      ["configure_approvals", 3, true],
    ],
  },
  Giving: {
    scopes: ["branch"],
    actions: [
      ["manage_options", 2],
      ["view_donor_details", 2],
      ["reconcile_payment", 2],
      ["message_donor", 2],
      ["export", 2],
      ["view_full_account_number", 3],
      ["archive", 3],
      ["manage_settlement_account", 3, true],
    ],
  },
  Pledges: {
    scopes: ["assigned", "branch"],
    viewScope: "assigned",
    actions: [
      ["create", 2],
      ["edit", 2],
      ["record_redemption", 2],
      ["reconcile_online", 2],
      ["send_reminders", 2],
      ["manage_callers", 2],
      ["view_payer_details", 2],
      ["export", 2],
      ["delete", 3],
      ["reverse_redemption", 3, true],
    ],
  },
  Requisition: {
    scopes: ["own", "department", "branch"],
    viewScope: "own",
    actions: [
      ["raise", 1],
      ["approve", 1],
      ["edit_as_approver", 1],
      ["comment", 1],
      ["delete_own_draft", 1],
      ["raise_for_any_department", 2],
      ["send_reminders", 2],
      ["export", 2],
      ["mark_disbursed", 2, true],
      ["delete", 3],
      ["override_step", 3, true],
      ["configure_approvals", 3, true],
    ],
  },
  Asset: {
    scopes: ["department_member", "department", "branch"],
    actions: [
      ["count", 1],
      ["create", 2],
      ["edit", 2],
      ["assign", 2],
      ["change_status", 2],
      ["raise_requisition", 2],
      ["clear_repair", 2],
      ["stock_check", 2],
      ["reconcile", 2],
      ["request_recount", 2],
      ["export", 2],
      ["delete", 3],
      ["write_off", 3, true],
    ],
  },
  Marketplace: {
    scopes: ["branch"],
    actions: [
      ["manage_markets", 2],
      ["manage_catalog", 2],
      ["publish_product", 2],
      ["create_order_for_member", 2],
      ["fulfil_order", 2],
      ["edit_order_items", 2],
      ["cancel_any_order", 2],
      ["reconcile_payments", 2],
      ["export_orders", 2],
      ["mark_paid", 2, true],
      ["delete", 3],
    ],
  },
  Access_rights: {
    scopes: ["branch"],
    actions: [
      ["create_role", 2],
      ["edit_role", 2],
      ["assign_roles", 2],
      ["edit_workspaces", 2],
      ["invite_users", 2],
      ["reset_password", 2],
      ["deactivate_users", 2],
      ["delete_role", 3],
    ],
  },
  Positions: {
    scopes: ["branch"],
    actions: [
      ["create", 2],
      ["edit", 2],
      ["delete", 3],
    ],
  },
  Settings: {
    scopes: ["branch"],
    actions: [
      ["view_logs", 1],
      ["configure_general", 2],
      ["manage_branches", 3, true],
    ],
  },
  AI: {
    scopes: ["branch"],
    actions: [
      ["chat", 1],
      ["generate_insights", 1],
      ["query_data", 1],
      ["view_tasks", 1],
      ["view_usage", 1],
      ["manage_credentials", 3, true],
    ],
  },
};
