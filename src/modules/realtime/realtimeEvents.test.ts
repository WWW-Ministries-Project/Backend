import test from "node:test";
import assert from "node:assert/strict";
import { buildEnvelope, REALTIME_EVENT_VERSION } from "./realtimeEvents";

test("buildEnvelope adds v and at to the body", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");
  assert.deepEqual(buildEnvelope({ reasons: ["profile"] }, now), {
    reasons: ["profile"],
    v: REALTIME_EVENT_VERSION,
    at: "2026-10-16T09:00:00.000Z",
  });
});

test("buildEnvelope: body cannot override v or at", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");
  const envelope = buildEnvelope({ v: 99, at: "x", unreadCount: 2 }, now);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.at, "2026-10-16T09:00:00.000Z");
  assert.equal(envelope.unreadCount, 2);
});
