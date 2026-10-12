import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NOTIFICATION_DELETE_IDS,
  parseNotificationDeleteIds,
} from "./notificationDeleteIds";

test("parseNotificationDeleteIds accepts numbers and numeric strings", () => {
  assert.deepEqual(parseNotificationDeleteIds({ ids: [1, "2", " 3 "] }), [1, 2, 3]);
});

test("parseNotificationDeleteIds collapses repeats", () => {
  assert.deepEqual(parseNotificationDeleteIds({ ids: [5, "5", 6] }), [5, 6]);
});

test("parseNotificationDeleteIds rejects missing or empty arrays", () => {
  assert.throws(() => parseNotificationDeleteIds({}), /non-empty/);
  assert.throws(() => parseNotificationDeleteIds({ ids: [] }), /non-empty/);
  assert.throws(() => parseNotificationDeleteIds({ ids: "1,2" }), /non-empty/);
  assert.throws(() => parseNotificationDeleteIds(null), /non-empty/);
  assert.throws(() => parseNotificationDeleteIds([1, 2]), /non-empty/);
});

test("parseNotificationDeleteIds rejects non-positive or non-integer ids", () => {
  for (const bad of [0, -1, 1.5, "abc", "", null, {}, true, Number.NaN, 2 ** 60]) {
    assert.throws(
      () => parseNotificationDeleteIds({ ids: [1, bad] }),
      /positive integer/,
      `expected ${String(bad)} to be rejected`,
    );
  }
});

test("parseNotificationDeleteIds caps the batch at 500", () => {
  const ids = Array.from({ length: MAX_NOTIFICATION_DELETE_IDS }, (_, i) => i + 1);
  assert.equal(parseNotificationDeleteIds({ ids }).length, 500);
  assert.throws(
    () => parseNotificationDeleteIds({ ids: [...ids, 501] }),
    /at most 500/,
  );
});
