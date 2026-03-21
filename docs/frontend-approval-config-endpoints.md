# Frontend Notes: Approval Config Endpoints

## Summary
Approval config endpoints are now split by domain:

- Requisition config uses `/requisitions/*`
- Event report config uses `/event-reports/*`

Do not use requisition endpoints for event report config.

## Event Report Approval Config

### Get config
- `GET /event-reports/get-approval-config`
- Auth: Bearer token
- Permission: user must be able to view events

Success response:

```json
{
  "message": "Operation successful",
  "data": {
    "module": "EVENT_REPORT",
    "requester_user_ids": [],
    "notification_user_ids": [618],
    "similar_item_lookback_days": 30,
    "finance_approver": {
      "type": "POSITION",
      "position_id": 12
    },
    "approvers": [
      { "order": 1, "type": "SPECIFIC_PERSON", "user_id": 1 }
    ],
    "is_active": true
  }
}
```

### Save config
- `POST /event-reports/upsert-approval-config`
- Auth: Bearer token
- Permission: user must be able to manage events

Request body:

```json
{
  "notification_user_ids": [618],
  "similar_item_lookback_days": 30,
  "finance_approver": {
    "type": "POSITION",
    "position_id": 12
  },
  "approvers": [
    { "order": 1, "type": "SPECIFIC_PERSON", "user_id": 1 }
  ],
  "is_active": true
}
```

Notes:
- `module` is not required. If sent, it must be `"EVENT_REPORT"`.
- `requester_user_ids` is not used for event report config. Backend always stores/returns it as an empty array.
- `finance_approver` configures the single approver used for the Finance section in event report details.
- Approver `order` must be sequential from `1`.
- `type` rules:
  - `HEAD_OF_DEPARTMENT`: no `position_id`, no `user_id`
  - `POSITION`: requires `position_id`, no `user_id`
  - `SPECIFIC_PERSON`: requires `user_id`, no `position_id`

## Requisition Approval Config

### Endpoints
- `GET /requisitions/get-approval-config`
- `POST /requisitions/upsert-approval-config`

Important:
- Requisition save endpoint now only accepts module `REQUISITION`.
- If you send `module: "EVENT_REPORT"` to requisition save, API returns:
  - `"Use the event report approval config endpoint for EVENT_REPORT module"`
