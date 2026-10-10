import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAudience } from "./audience";

test("church audience with toggles", () => {
  assert.deepEqual(parseAudience({ scope: "CHURCH", includeGuests: true }), {
    scope: "CHURCH", departmentIds: [], userIds: [], includeGuests: true, includeVisitors: false,
  });
});

test("departments require at least one id and dedupe ids", () => {
  assert.deepEqual(parseAudience({ scope: "DEPARTMENTS", departmentIds: [3, "3", 4] }).departmentIds, [3, 4]);
  assert.throws(() => parseAudience({ scope: "DEPARTMENTS", departmentIds: [] }), /department/i);
});

test("people require at least one id; toggles ignored outside CHURCH", () => {
  const a = parseAudience({ scope: "PEOPLE", userIds: [7], includeGuests: true, includeVisitors: true });
  assert.deepEqual(a, { scope: "PEOPLE", departmentIds: [], userIds: [7], includeGuests: false, includeVisitors: false });
  assert.throws(() => parseAudience({ scope: "PEOPLE", userIds: [] }), /person/i);
});

test("rejects unknown scope", () => {
  assert.throws(() => parseAudience({ scope: "EVERYONE" }), /scope/i);
  assert.throws(() => parseAudience(null), /scope/i);
});
