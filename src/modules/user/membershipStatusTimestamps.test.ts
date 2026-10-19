import test from "node:test";
import assert from "node:assert/strict";
import { buildMembershipStatusTimestampData } from "./membershipStatusTimestamps";

const now = new Date("2026-10-18T10:00:00Z");
const earlier = new Date("2026-01-01T00:00:00Z");

test("unchanged status leaves stamps untouched", () => {
  assert.deepEqual(
    buildMembershipStatusTimestampData({ status: "CONFIRMED", confirmed_at: earlier }, "confirmed", now),
    {},
  );
  assert.deepEqual(buildMembershipStatusTimestampData({ status: null }, null, now), {});
});

test("UNCONFIRMED -> CONFIRMED stamps confirmed_at only", () => {
  assert.deepEqual(buildMembershipStatusTimestampData({ status: "UNCONFIRMED" }, "CONFIRMED", now), {
    confirmed_at: now,
    functional_at: null,
  });
});

test("CONFIRMED -> MEMBER keeps confirmed_at and stamps functional_at", () => {
  assert.deepEqual(
    buildMembershipStatusTimestampData({ status: "CONFIRMED", confirmed_at: earlier }, "MEMBER", now),
    { confirmed_at: earlier, functional_at: now },
  );
});

test("skipping a stage stamps both", () => {
  assert.deepEqual(buildMembershipStatusTimestampData({ status: null }, "MEMBER", now), {
    confirmed_at: now,
    functional_at: now,
  });
});

test("moving backwards clears later stamps", () => {
  const member = { status: "MEMBER", confirmed_at: earlier, functional_at: earlier };
  assert.deepEqual(buildMembershipStatusTimestampData(member, "CONFIRMED", now), {
    confirmed_at: earlier,
    functional_at: null,
  });
  assert.deepEqual(buildMembershipStatusTimestampData(member, "UNCONFIRMED", now), {
    confirmed_at: null,
    functional_at: null,
  });
  assert.deepEqual(buildMembershipStatusTimestampData(member, null, now), {
    confirmed_at: null,
    functional_at: null,
  });
});

test("new users: stamped by initial status, nothing for unconfirmed/null", () => {
  assert.deepEqual(buildMembershipStatusTimestampData(null, "UNCONFIRMED", now), {});
  assert.deepEqual(buildMembershipStatusTimestampData(null, undefined, now), {});
  assert.deepEqual(buildMembershipStatusTimestampData(null, "CONFIRMED", now), {
    confirmed_at: now,
    functional_at: null,
  });
  assert.deepEqual(buildMembershipStatusTimestampData(null, "MEMBER", now), {
    confirmed_at: now,
    functional_at: now,
  });
});
