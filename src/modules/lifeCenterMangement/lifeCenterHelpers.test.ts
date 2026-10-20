import test from "node:test";
import assert from "node:assert/strict";
import {
  builtInRoleKey,
  cityFromLocation,
  isLeaderReminderReason,
  isLeaderRoleName,
  isProtectedRoleName,
  isReminderOnCooldown,
  parseDateBoundary,
  parseMeetingDays,
  scopeAllows,
  toDateKey,
  utcDayBounds,
} from "./lifeCenterHelpers";

test("role names match case-insensitively, with _ or - as spaces", () => {
  assert.equal(isLeaderRoleName("LEADER"), true);
  assert.equal(isLeaderRoleName(" leader "), true);
  assert.equal(isLeaderRoleName("Assistant leader"), false);
  assert.equal(builtInRoleKey("ASSISTANT_LEADER"), "assistant");
  assert.equal(builtInRoleKey("assistant-Leader"), "assistant");
  assert.equal(builtInRoleKey("MEMBER"), "member");
  assert.equal(builtInRoleKey("Secretary"), null);
  assert.equal(builtInRoleKey(null), null);
});

test("Leader and Member are protected, Assistant leader is not", () => {
  assert.equal(isProtectedRoleName("Leader"), true);
  assert.equal(isProtectedRoleName("MEMBER"), true);
  assert.equal(isProtectedRoleName("Assistant leader"), false);
  assert.equal(isProtectedRoleName("Host"), false);
});

test("parseMeetingDays trims and drops empties", () => {
  assert.deepEqual(parseMeetingDays("Monday, Wednesday"), ["Monday", "Wednesday"]);
  assert.deepEqual(parseMeetingDays("Friday,"), ["Friday"]);
  assert.deepEqual(parseMeetingDays(""), []);
  assert.deepEqual(parseMeetingDays(null), []);
});

test("toDateKey formats the stored UTC date", () => {
  assert.equal(toDateKey(new Date("2026-10-20T23:30:00.000Z")), "2026-10-20");
  assert.equal(toDateKey("2026-01-05T00:00:00.000Z"), "2026-01-05");
  assert.equal(toDateKey(null), null);
  assert.equal(toDateKey("nope"), null);
});

test("utcDayBounds spans one UTC day", () => {
  const { start, end } = utcDayBounds(new Date("2026-10-20T15:45:00.000Z"));
  assert.equal(start.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-21T00:00:00.000Z");
});

test("parseDateBoundary covers the whole day and rejects bad input", () => {
  assert.equal(parseDateBoundary(undefined, "from"), undefined);
  assert.equal(parseDateBoundary("", "to"), undefined);
  assert.equal(
    parseDateBoundary("2026-10-01", "from")?.toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(
    parseDateBoundary("2026-10-31", "to")?.toISOString(),
    "2026-10-31T23:59:59.999Z",
  );
  assert.throws(() => parseDateBoundary("2026-02-30", "from"), /valid date/);
  assert.throws(() => parseDateBoundary("10/01/2026", "to"), /YYYY-MM-DD/);
});

test("cityFromLocation takes the first part", () => {
  assert.equal(cityFromLocation("Adenta, Accra"), "Adenta");
  assert.equal(cityFromLocation("East Legon"), "East Legon");
  assert.equal(cityFromLocation(undefined), "");
});

test("scopeAllows only restricts member scope", () => {
  assert.equal(scopeAllows(undefined, 3), true);
  assert.equal(scopeAllows({ mode: "all", lifeCenterIds: [] }, 3), true);
  assert.equal(scopeAllows({ mode: "member", lifeCenterIds: [1, 3] }, 3), true);
  assert.equal(scopeAllows({ mode: "member", lifeCenterIds: [1] }, 3), false);
});

test("reminder cooldown is 24 hours", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(isReminderOnCooldown(null, now), false);
  assert.equal(isReminderOnCooldown(new Date(now - 23 * 3600_000), now), true);
  assert.equal(isReminderOnCooldown(new Date(now - 25 * 3600_000), now), false);
});

test("reminder reasons", () => {
  assert.equal(isLeaderReminderReason("overdue"), true);
  assert.equal(isLeaderReminderReason("attendance"), true);
  assert.equal(isLeaderReminderReason("late"), false);
  assert.equal(isLeaderReminderReason(1), false);
});
