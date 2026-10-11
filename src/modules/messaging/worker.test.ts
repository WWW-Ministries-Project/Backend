import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAttemptDelayMs, MAX_ATTEMPTS, outcomeData, runExclusive, summarize } from "./worker";

test("backoff 1 and 5 minutes; FAILED at max attempts", () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(nextAttemptDelayMs(0), 60_000);
  assert.equal(nextAttemptDelayMs(1), 60_000);
  assert.equal(nextAttemptDelayMs(2), 5 * 60_000);
  assert.equal(nextAttemptDelayMs(3), null);
});

test("summarize groups counts per channel and reports open work", () => {
  const result = summarize([
    { channel: "SMS", status: "SENT", _count: { _all: 3 } },
    { channel: "SMS", status: "SKIPPED", _count: { _all: 1 } },
    { channel: "EMAIL", status: "PENDING", _count: { _all: 2 } },
    { channel: "IN_APP", status: "SENDING", _count: { _all: 4 } },
  ]);
  assert.deepEqual(result.counts.sms, { sent: 3, failed: 0, skipped: 1, pending: 0 });
  assert.deepEqual(result.counts.email, { sent: 0, failed: 0, skipped: 0, pending: 2 });
  assert.deepEqual(result.counts.inApp, { sent: 0, failed: 0, skipped: 0, pending: 4 });
  assert.equal(result.open, 6);
});

test("outcomeData maps each outcome to its recipient update", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  assert.deepEqual(outcomeData({ kind: "skipped", reason: "No phone number" }, 0, now), {
    status: "SKIPPED",
    error: "No phone number",
    claimed_at: null,
  });
  assert.deepEqual(outcomeData({ kind: "sent" }, 1, now), {
    status: "SENT",
    sent_at: now,
    error: null,
    claimed_at: null,
  });
  assert.deepEqual(outcomeData({ kind: "failed", error: "timeout", permanent: false }, 0, now), {
    attempts: 1,
    error: "timeout",
    claimed_at: null,
    status: "PENDING",
    next_attempt_at: new Date(now.getTime() + 60_000),
  });
  assert.deepEqual(outcomeData({ kind: "failed", error: "bad number", permanent: true }, 0, now), {
    attempts: 1,
    error: "bad number",
    claimed_at: null,
    status: "FAILED",
  });
  assert.deepEqual(outcomeData({ kind: "failed", error: "timeout", permanent: false }, 2, now), {
    attempts: 3,
    error: "timeout",
    claimed_at: null,
    status: "FAILED",
  });
});

test("runExclusive refuses a second run while the first is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let secondRan = false;
  const first = runExclusive(() => gate);
  const second = await runExclusive(async () => {
    secondRan = true;
  });
  assert.equal(second, false);
  assert.equal(secondRan, false);
  release();
  assert.equal(await first, true);
});

test("runExclusive resets the flag after fn throws", async () => {
  await assert.rejects(
    runExclusive(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  let ran = false;
  assert.equal(
    await runExclusive(async () => {
      ran = true;
    }),
    true,
  );
  assert.equal(ran, true);
});
