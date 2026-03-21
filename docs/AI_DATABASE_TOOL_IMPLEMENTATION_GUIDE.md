# AI Database Tool Implementation Guide

## Goal

Build a safe, high-utility database tool layer that OpenAI, Claude, and Gemini can use to answer operational questions from your backend data without giving the model raw SQL access.

This backend is already close to the right shape:

- Prisma schema in `prisma/schema.prisma`
- AI chat/tool orchestration in `src/modules/ai/aiService.ts`
- read-only tool contracts in `src/modules/ai/aiReadOnlyContracts.ts`
- read-only query execution in `src/modules/ai/aiReadOnlyDataService.ts`
- business context enrichment in `src/modules/ai/aiBusinessContextService.ts`

The correct next step is not "let the model query the database directly". The correct step is to expand the existing governed read-only contract layer into a richer domain tool system.

## What The Schema Contains

The schema currently has 96 Prisma models. The major business domains are:

- People and organization
  - `user`, `user_info`, `family_relation`, `department`, `position`, `access_level`, `user_departments`
- Events and attendance
  - `event_act`, `event_mgt`, `event_attendance_summary`, `event_attendance`, `event_registers`, `event_biometric_punch`, `event_biometric_import_job`
- Event reporting and approvals
  - `event_reports`, `event_report_department_approvals`, `event_report_attendance_approval`, `event_report_finance`, `event_report_finance_approvals`, `event_report_final_approval_instances`, `event_report_notification_events`
- Requisitions and approvals
  - `request`, `requested_item`, `request_comments`, `request_attachment`, `request_approvals`, `requisition_approval_configs`, `requisition_approval_config_steps`, `requisition_approval_instances`, `requisition_notification_events`, `requisition_edit_logs`
- Programs and training
  - `program`, `program_prerequisites`, `cohort`, `course`, `enrollment`, `progress`, `topic`, `LearningUnit`, `assignment_submission`, `certificate`, `role_eligibility_rules`
- Visitor care
  - `visitor`, `visit`, `follow_up`, `prayer_request`, `note`, `soul_won`
- Life center
  - `life_center`, `life_center_role`, `life_center_member`
- Marketplace and orders
  - `markets`, `products`, `product_type`, `product_category`, `product_colour`, `product_stock`, `orders`, `order_items`, `billing_details`
- Finance and finance config
  - `financials`, `receiptConfig`, `paymentConfig`, `bankAccountConfig`, `titheBreakdownConfig`
- Appointments and availability
  - `availability`, `session_slot`, `appointment`
- Notifications and system settings
  - `in_app_notification`, `notification_preference`, `notification_push_subscription`, `notification_push_delivery_job`, `notification_sms_delivery_job`, `system_notification_settings`, `attendance_timing_settings`
- AI operations
  - `ai_conversation`, `ai_message`, `ai_usage_ledger`, `ai_usage_quota`, `ai_pricing_catalog`, `ai_audit_log`, `ai_idempotency_key`, `ai_provider_credential`

The biggest clusters are event-related, requisition-related, notification-related, and AI-ops-related tables. That means the assistant can become genuinely useful for operations, finance-adjacent reporting, approvals, attendance, visitor care, and internal support workflows.

## What Already Exists

The current AI module already has the foundation of a safe tool architecture:

- The model does not execute SQL.
- The model gets a constrained tool list.
- Tool inputs are validated.
- Queries are read-only.
- Calls are audited.
- Business context is preloaded for common intents.

Current safe tools:

- `list_read_only_query_contracts`
- `read_module_data`

Current read-only operations:

- `summary`
- `recent`
- `search`
- `attendance_lookup`

Current read-only module coverage is good but still shallow:

- `user`
- `department`
- `position`
- `access`
- `upload`
- `assets`
- `event`
- `requisitions`
- `program`
- `visitor`
- `lifecenter`
- `device`
- `market`
- `product`
- `orders`
- `theme`
- `appointment`
- `receiptconfig`
- `paymentconfig`
- `bankaccountconfig`
- `tithebreakdownconfig`
- `financials`
- `ai`

## Gaps That Limit Intelligence Today

### 1. The model can query data, but it cannot inspect the business schema well

`list_read_only_query_contracts` tells the model which module names exist, but not:

- the primary tables behind each module
- the join paths
- the important business fields
- which fields are sensitive
- which questions a module is good at answering

Result: the model can fetch data, but it still has to guess the semantic shape of the backend too often.

### 2. Operations are too shallow for real analytical assistance

`summary`, `recent`, and `search` are useful, but they do not cover many real questions such as:

- "show this requisition with items, approvals, and comments"
- "what follow-ups are overdue by assignee"
- "which programs are blocked by prerequisites"
- "what products are low in stock by size/color"
- "which event reports are pending finance approval"
- "what notification jobs are failing repeatedly"

### 3. Sensitive fields are exposed too broadly

Some current read-only queries return PII:

- `user` returns `email`, `member_id`
- `visitor` returns `email`, `phone`
- `appointment` returns `email`, `phone`

That is acceptable only if the caller's role is explicitly allowed to view those fields. Right now the read-only layer is module-based, not field-policy-based.

### 4. Row-level authorization is not encoded into tool execution

The AI endpoints check for AI permissions, but the query layer itself does not yet enforce domain scoping such as:

- "only my department"
- "only my assigned approvals"
- "only my appointments"
- "only records tied to my role"

### 5. Important tables are not first-class AI domains yet

High-value schema areas are still missing from the AI contract surface:

- event report workflow tables
- requisition approval config and approval instance detail
- notification queues and failures
- program eligibility rules and certificates
- product stock detail
- system settings and attendance timing rules

## Recommended Architecture

### Principle

Do not build "AI writes SQL".

Build "AI chooses from safe, domain-aware tools".

The tool layer should be:

- read-only by default
- contract-based
- field-redacted
- role-aware
- audit logged
- deterministic

### Layer 1: Schema catalog

Add a schema catalog that explains each AI domain in business language.

Suggested file:

- `src/modules/ai/aiSchemaCatalog.ts`

Suggested shape:

```ts
type AiDomainSchema = {
  module: string;
  summary: string;
  primary_models: string[];
  related_models: string[];
  searchable_fields: string[];
  metric_fields: string[];
  sensitive_fields: string[];
  sample_questions: string[];
};
```

Suggested tool:

- `describe_data_domain`

This tool should return:

- what the module represents
- which tables back it
- what filters exist
- what metrics it can answer
- what operations are safe
- what fields are redacted by policy

This is the fastest way to make the model "smarter" without making it less safe.

### Layer 2: Richer read-only operations

Expand beyond `summary`, `recent`, `search`.

Recommended new operation families:

- `detail`
  - fetch one record with related entities
- `metrics`
  - counts, grouped totals, status buckets
- `timeline`
  - ordered history for a record or workflow
- `queue`
  - pending/blocked/overdue work items
- `breakdown`
  - grouped aggregates by department, status, date, assignee, role
- `related`
  - resolve connected records safely

Examples by domain:

- requisitions
  - `detail`, `timeline`, `queue`
- event reports
  - `detail`, `queue`, `breakdown`
- visitors
  - `detail`, `queue`, `breakdown`
- products
  - `detail`, `breakdown`
- notifications
  - `queue`, `breakdown`

### Layer 3: Field-level policy

Add a policy layer between tool execution and response serialization.

Suggested file:

- `src/modules/ai/aiDataAccessPolicy.ts`

Responsibilities:

- decide visible fields by actor scope
- redact phone, email, member IDs, billing data where needed
- restrict sensitive modules for lower scopes

Example:

```ts
type AiFieldPolicy = {
  canViewPII: boolean;
  canViewFinance: boolean;
  canViewNotifications: boolean;
};
```

### Layer 4: Row-level scoping

Make the tool layer aware of actor context:

- actor user id
- department id
- role
- access level

Then apply scope at query time, not after fetch time.

Examples:

- approval queues only show items assigned to the actor unless scope is admin
- appointment tool only shows owned or assigned appointments unless scope is admin
- visitor follow-up queues can be filtered to `assignedTo = actorId`

### Layer 5: Domain-specific insight helpers

For repeated high-value questions, do not force the model to compose many small queries every time.

Build helper functions for:

- pending approvals
- attendance rollups
- event report bottlenecks
- low-stock products
- overdue follow-ups
- finance snapshot summaries
- notification delivery failures

That pattern already exists in `aiBusinessContextService.ts`. Expand it.

## Concrete Files To Add Next

Recommended order:

1. `src/modules/ai/aiSchemaCatalog.ts`
2. `src/modules/ai/aiDataAccessPolicy.ts`
3. `src/modules/ai/aiReadOnlySerializer.ts`
4. `src/modules/ai/aiReadOnlyDataService.ts`
   - add `detail`, `queue`, `breakdown`, `timeline`
5. `src/modules/ai/aiPolicyService.ts`
   - tell the model when to use schema vs data tools

## Suggested Tool Surface

Keep the tool count small and purposeful.

Recommended first set:

- `describe_data_domain`
- `list_read_only_query_contracts`
- `read_module_data`

Then extend `read_module_data` operations instead of adding dozens of tiny tools.

This is better than creating separate tools like:

- `get_requisition`
- `get_event_report`
- `get_visitor_followups`
- `get_low_stock_products`

Too many tools lowers accuracy. A smaller number of well-described tools is easier for all model providers.

## Example Contract Direction

Example for requisitions:

```ts
{
  module: "requisitions",
  operations: [
    "summary",
    "recent",
    "search",
    "detail",
    "timeline",
    "queue",
    "breakdown"
  ]
}
```

Example `detail` input:

```json
{
  "request_id": "REQ-2026-00124",
  "include": ["items", "comments", "approval_instances", "department", "requester"]
}
```

Example `queue` input:

```json
{
  "assignee": "me",
  "status": "pending",
  "limit": 10
}
```

## Rollout Plan

### Phase 1

- Keep current architecture
- add Gemini tool loop
- add schema catalog tool
- add field redaction policy

### Phase 2

- add `detail`, `queue`, `breakdown`, `timeline`
- add event report and notification domains
- add product stock detail and certificate/eligibility coverage

### Phase 3

- add evaluation prompts and golden questions
- log tool selection success/failure
- tune prompts and tool descriptions from real usage

## What "Smart" Should Mean Here

For this application, "smart" should mean:

- grounded in real database facts
- understands business relationships between tables
- knows which tool to call
- avoids hallucinated counts and statuses
- respects privacy and scope
- produces operationally useful answers, not generic chat

That is how you make the assistant intelligent in a production backend.

