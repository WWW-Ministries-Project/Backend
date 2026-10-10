import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAttemptDelayMs, MAX_ATTEMPTS, summarize } from "./worker";

test("backoff 1, 5, 15 minutes; null at max", () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(nextAttemptDelayMs(1), 60_000);
  assert.equal(nextAttemptDelayMs(2), 5 * 60_000);
  assert.equal(nextAttemptDelayMs(3), null);
});

test("summarize groups counts per channel and reports open work", () => {
  const result = summarize([
    { channel: "SMS", status: "SENT", _count: { _all: 3 } },
    { channel: "SMS", status: "SKIPPED", _count: { _all: 1 } },
    { channel: "EMAIL", status: "PENDING", _count: { _all: 2 } },
  ]);
  assert.deepEqual(result.counts.sms, { sent: 3, failed: 0, skipped: 1, pending: 0 });
  assert.deepEqual(result.counts.email, { sent: 0, failed: 0, skipped: 0, pending: 2 });
  assert.equal(result.open, 2);
});
