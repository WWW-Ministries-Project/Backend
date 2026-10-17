import test from "node:test";
import assert from "node:assert/strict";
import { createSessionNotifier, sessionReasonsForUserUpdate } from "./sessionNotifier";

const recorder = () => {
  const calls: string[] = [];
  const notifier = createSessionNotifier({
    invalidateAuthContext: (id) => {
      calls.push(`invalidate:${id}`);
    },
    refreshRooms: async (id) => {
      calls.push(`rooms:${id}`);
    },
    toUser: (id, event, body) => {
      calls.push(`emit:${id}:${event}:${JSON.stringify(body)}`);
    },
    disconnectUser: (id) => {
      calls.push(`disconnect:${id}`);
    },
  });
  return { calls, notifier };
};

test("sessionChanged: invalidate → rooms → emit, per user, deduped", async () => {
  const { calls, notifier } = recorder();
  await notifier.sessionChanged([2, 2, 3], ["permissions"]);
  assert.deepEqual(calls, [
    "invalidate:2",
    "rooms:2",
    'emit:2:session.changed:{"reasons":["permissions"]}',
    "invalidate:3",
    "rooms:3",
    'emit:3:session.changed:{"reasons":["permissions"]}',
  ]);
});

test("sessionChanged: no ids or no reasons does nothing", async () => {
  const { calls, notifier } = recorder();
  await notifier.sessionChanged([], ["profile"]);
  await notifier.sessionChanged([1], []);
  assert.deepEqual(calls, []);
});

test("sessionChanged: a failing refreshRooms still emits and never throws", async () => {
  const calls: string[] = [];
  const notifier = createSessionNotifier({
    invalidateAuthContext: () => undefined,
    refreshRooms: async () => {
      throw new Error("db down");
    },
    toUser: (id, event) => {
      calls.push(`${id}:${event}`);
    },
    disconnectUser: () => undefined,
  });
  await assert.doesNotReject(notifier.sessionChanged([1], ["departments"]));
  assert.deepEqual(calls, ["1:session.changed"]);
});

test("sessionRevoked: invalidate → emit → disconnect", () => {
  const { calls, notifier } = recorder();
  notifier.sessionRevoked(5, "deactivated");
  assert.deepEqual(calls, [
    "invalidate:5",
    'emit:5:session.revoked:{"reason":"deactivated"}',
    "disconnect:5",
  ]);
});

test("sessionReasonsForUserUpdate", () => {
  const before = { is_user: true, access_level_id: 1, department_id: 4, branch_id: 1 };
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before }, false), ["profile"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, access_level_id: 2 }, false), ["profile", "permissions"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, is_user: false }, false), ["profile", "permissions"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, department_id: 5 }, false), ["profile", "departments"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before, branch_id: 2 }, false), ["profile", "departments"]);
  assert.deepEqual(sessionReasonsForUserUpdate(before, { ...before }, true), ["profile", "departments"]);
});
