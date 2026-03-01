export type AiModuleName =
  | "user"
  | "department"
  | "position"
  | "access"
  | "upload"
  | "assets"
  | "event"
  | "requisitions"
  | "program"
  | "visitor"
  | "lifecenter"
  | "device"
  | "market"
  | "product"
  | "orders"
  | "theme"
  | "appointment"
  | "receiptconfig"
  | "paymentconfig"
  | "bankaccountconfig"
  | "tithebreakdownconfig"
  | "financials"
  | "ai";

export type AiReadOnlyOperationName =
  | "summary"
  | "recent"
  | "search"
  | "attendance_lookup";

export type AiReadOnlyOperationContract = {
  name: AiReadOnlyOperationName;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AiModuleQueryContract = {
  module: AiModuleName;
  description: string;
  operations: AiReadOnlyOperationContract[];
};

export const DEFAULT_RECENT_LIMIT = 8;
export const MAX_RECENT_LIMIT = 25;

const DATE_RANGE_PROPERTIES = {
  start_date: {
    type: "string",
    description: "Inclusive start date in YYYY-MM-DD.",
  },
  end_date: {
    type: "string",
    description: "Inclusive end date in YYYY-MM-DD.",
  },
};

const BASE_RECENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...DATE_RANGE_PROPERTIES,
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RECENT_LIMIT,
      description: `Max rows to return (default ${DEFAULT_RECENT_LIMIT}).`,
    },
  },
};

const BASE_SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["q"],
  properties: {
    ...DATE_RANGE_PROPERTIES,
    q: {
      type: "string",
      minLength: 2,
      description: "Case-insensitive search phrase.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RECENT_LIMIT,
      description: `Max rows to return (default ${DEFAULT_RECENT_LIMIT}).`,
    },
  },
};

const BASE_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...DATE_RANGE_PROPERTIES,
  },
};

const ATTENDANCE_LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...DATE_RANGE_PROPERTIES,
    event_id: {
      type: "integer",
      minimum: 1,
      description: "Filter by event_mgt id.",
    },
    event_name: {
      type: "string",
      minLength: 2,
      description: "Partial event name match.",
    },
    date: {
      type: "string",
      description: "Attendance date in YYYY-MM-DD.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RECENT_LIMIT,
      description: `Max rows to return (default ${DEFAULT_RECENT_LIMIT}).`,
    },
  },
};

const CONTRACTS: Record<AiModuleName, AiModuleQueryContract> = {
  user: {
    module: "user",
    description: "Church members and user directory data.",
    operations: [
      { name: "summary", description: "User/member counts and activity snapshot.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created users.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search users by name/email/member id.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  department: {
    module: "department",
    description: "Department structure and ownership.",
    operations: [
      { name: "summary", description: "Department count and staffing signal.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created departments.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  position: {
    module: "position",
    description: "Role/position registry.",
    operations: [
      { name: "summary", description: "Position count and departmental allocation.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created positions.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  access: {
    module: "access",
    description: "Access levels and permission profiles.",
    operations: [
      { name: "summary", description: "Access-level inventory summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Recently created access levels.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  upload: {
    module: "upload",
    description: "Uploaded media/files stored on backend filesystem.",
    operations: [
      { name: "summary", description: "Upload file-count and storage-size estimate.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently modified upload files.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  assets: {
    module: "assets",
    description: "Asset inventory and lifecycle records.",
    operations: [
      { name: "summary", description: "Asset count/value summary by status.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created assets.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search assets by name/supplier.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  event: {
    module: "event",
    description: "Event calendar, registrations, and attendance summary.",
    operations: [
      { name: "summary", description: "Event count and attendance coverage summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created events.", input_schema: BASE_RECENT_SCHEMA },
      { name: "attendance_lookup", description: "Attendance summary lookup by event/date.", input_schema: ATTENDANCE_LOOKUP_SCHEMA },
    ],
  },
  requisitions: {
    module: "requisitions",
    description: "Purchase requisitions and approval workflow.",
    operations: [
      { name: "summary", description: "Requisition volume and status summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recent requisitions.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search requisitions by request id or requester.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  program: {
    module: "program",
    description: "School of ministry programs, cohorts, courses, enrollments.",
    operations: [
      { name: "summary", description: "Program/cohort/course/enrollment summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently updated programs.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search programs by title.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  visitor: {
    module: "visitor",
    description: "Visitor intake, visits, follow-up, and prayer requests.",
    operations: [
      { name: "summary", description: "Visitor and follow-up status summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created visitors.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search visitors by name/email/phone.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  lifecenter: {
    module: "lifecenter",
    description: "Life center structure and membership assignments.",
    operations: [
      { name: "summary", description: "Life center and member allocation summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created life centers.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  device: {
    module: "device",
    description: "Integrated attendance/device registry.",
    operations: [
      { name: "summary", description: "Device inventory summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently added devices.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  market: {
    module: "market",
    description: "Marketplace market windows and linking.",
    operations: [
      { name: "summary", description: "Market lifecycle summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created markets.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search markets by name.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  product: {
    module: "product",
    description: "Marketplace product catalog.",
    operations: [
      { name: "summary", description: "Product status/count summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently created products.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search products by name.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  orders: {
    module: "orders",
    description: "Marketplace orders and fulfillment status.",
    operations: [
      { name: "summary", description: "Order volume/payment status summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recent orders.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search orders by order number/reference.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  theme: {
    module: "theme",
    description: "Annual church themes.",
    operations: [
      { name: "summary", description: "Theme history summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recent yearly themes.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  appointment: {
    module: "appointment",
    description: "Appointments and booking lifecycle.",
    operations: [
      { name: "summary", description: "Appointment status summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recent appointment bookings.", input_schema: BASE_RECENT_SCHEMA },
      { name: "search", description: "Search appointments by name/email.", input_schema: BASE_SEARCH_SCHEMA },
    ],
  },
  receiptconfig: {
    module: "receiptconfig",
    description: "Receipt configuration metadata.",
    operations: [
      { name: "summary", description: "Receipt config inventory.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently updated receipt configs.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  paymentconfig: {
    module: "paymentconfig",
    description: "Payment configuration metadata.",
    operations: [
      { name: "summary", description: "Payment config inventory.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently updated payment configs.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  bankaccountconfig: {
    module: "bankaccountconfig",
    description: "Bank account distribution configuration.",
    operations: [
      { name: "summary", description: "Bank account config inventory.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently updated bank account configs.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  tithebreakdownconfig: {
    module: "tithebreakdownconfig",
    description: "Tithe percentage breakdown configuration.",
    operations: [
      { name: "summary", description: "Tithe breakdown config inventory.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recently updated tithe breakdown configs.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  financials: {
    module: "financials",
    description: "Saved financial payload snapshots by period.",
    operations: [
      { name: "summary", description: "Financial snapshots summary.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Most recent financial snapshots.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
  ai: {
    module: "ai",
    description: "AI conversations, usage, and audit logs.",
    operations: [
      { name: "summary", description: "AI usage summary from ledger data.", input_schema: BASE_SUMMARY_SCHEMA },
      { name: "recent", description: "Recent AI conversations/messages.", input_schema: BASE_RECENT_SCHEMA },
    ],
  },
};

export const AI_MODULE_QUERY_CONTRACTS = CONTRACTS;

export const AI_MODULE_NAMES = Object.keys(AI_MODULE_QUERY_CONTRACTS) as AiModuleName[];

export const getModuleContract = (
  moduleName: string,
): AiModuleQueryContract | null => {
  const normalized = String(moduleName || "").trim().toLowerCase() as AiModuleName;
  return AI_MODULE_QUERY_CONTRACTS[normalized] || null;
};
