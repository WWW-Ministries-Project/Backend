import test from "node:test";
import assert from "node:assert/strict";
import { createRideChangeEmitter, rideEventTopic } from "./rideEvents";
import { createRideEventAuthorizer } from "./rideTopics";

const recorder = () => {
  const calls: { kind: string; target: unknown; event: string; body: unknown }[] = [];
  const emit = createRideChangeEmitter({
    toUser: (target, event, body) => {
      calls.push({ kind: "user", target, event, body });
    },
    toTopic: (target, event, body) => {
      calls.push({ kind: "topic", target, event, body });
    },
  });
  return { calls, emit };
};

test("rideEventTopic", () => {
  assert.equal(rideEventTopic(7), "ride-event:7");
});

test("parties de-duplicated; catalog goes to the event topic", () => {
  const { calls, emit } = recorder();
  emit({ eventId: 7, offerId: 3 }, [5, 5, 9, 0], { catalog: true });
  assert.deepEqual(calls, [
    { kind: "user", target: [5, 9], event: "rides.changed", body: { eventId: 7, offerId: 3 } },
    { kind: "topic", target: "ride-event:7", event: "rides.catalog_changed", body: { eventId: 7 } },
  ]);
});

test("no catalog emit without the flag or without an event", () => {
  const { calls, emit } = recorder();
  emit({ eventId: 7, offerId: 3 }, [5], { catalog: false });
  emit({ eventId: null, offerId: 3 }, [5], { catalog: true });
  assert.deepEqual(calls.map((call) => call.kind), ["user", "user"]);
});

test("no parties, no user emit", () => {
  const { calls, emit } = recorder();
  emit({ eventId: 7, offerId: 3 }, [], { catalog: true });
  assert.deepEqual(calls.map((call) => call.kind), ["topic"]);
});

const member = { userId: 4, isGuest: false, branchId: null };

test("ride-event authorizer", async () => {
  const authorize = createRideEventAuthorizer({
    isActiveMember: async (userId) => userId === 4,
    upcomingEventIds: async () => [7, 8],
  });
  assert.equal(await authorize(member, "7"), true);
  assert.equal(await authorize(member, "9"), false);
  assert.equal(await authorize(member, "x"), false);
  assert.equal(await authorize({ ...member, isGuest: true }, "7"), false);
  assert.equal(await authorize({ ...member, userId: 5 }, "7"), false);
});
