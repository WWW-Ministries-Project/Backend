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

test("userIds parsing is strict", () => {
  const a = parseAudience({
    scope: "PEOPLE",
    userIds: [true, [5], "1.5", " 7 ", "0x1F", 1e300, "8", 9],
  });
  assert.deepEqual(a.userIds, [8, 9]);
});

test("rejects more than 2000 recipients", () => {
  const userIds = Array.from({ length: 2001 }, (_, i) => i + 1);
  assert.throws(() => parseAudience({ scope: "PEOPLE", userIds }), /max 2000/);
});

test("string includeGuests is not truthy", () => {
  assert.equal(parseAudience({ scope: "CHURCH", includeGuests: "true" }).includeGuests, false);
});
