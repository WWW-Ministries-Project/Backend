import test from "node:test";
import assert from "node:assert/strict";
import {
  createTopicRegistry,
  MAX_TOPICS_PER_SOCKET,
  parseTopic,
  type TopicSocket,
} from "./realtimeTopics";

const member = { userId: 1, isGuest: false, branchId: null };

const fakeSocket = (): TopicSocket & { joined: string[]; left: string[] } => {
  const joined: string[] = [];
  const left: string[] = [];
  return {
    joined,
    left,
    data: { user: member, topics: new Set<string>(), subscribeTimes: [] },
    join: (room: string) => {
      joined.push(room);
    },
    leave: (room: string) => {
      left.push(room);
    },
  };
};

test("parseTopic", () => {
  assert.deepEqual(parseTopic("post:12"), { prefix: "post", id: "12", topic: "post:12" });
  assert.deepEqual(parseTopic("staff-slots:3"), { prefix: "staff-slots", id: "3", topic: "staff-slots:3" });
  assert.equal(parseTopic("post:"), null);
  assert.equal(parseTopic("post"), null);
  assert.equal(parseTopic("post:1:2"), null);
  assert.equal(parseTopic(42), null);
  assert.equal(parseTopic("post:" + "x".repeat(65)), null);
});

test("reserved prefixes cannot be registered", () => {
  const registry = createTopicRegistry();
  for (const prefix of ["user", "branch", "dept", "all"]) {
    assert.throws(() => registry.register(prefix, async () => true));
  }
});

test("subscribe: unknown prefix, bad topic", async () => {
  const registry = createTopicRegistry();
  const socket = fakeSocket();
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: false, code: "UNKNOWN_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "nope" }), { ok: false, code: "BAD_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, null), { ok: false, code: "BAD_TOPIC" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "user:1" }), { ok: false, code: "UNKNOWN_TOPIC" });
});

test("subscribe: authorizer decides; allowed topics are joined once", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async (_user, id) => id === "1");
  const socket = fakeSocket();
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:2" }), { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(socket.joined, ["post:1"]);
  assert.equal(socket.data.topics.size, 1);
});

test("subscribe: an authorizer that throws is FORBIDDEN, not a crash", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async () => {
    throw new Error("db down");
  });
  assert.deepEqual(await registry.subscribe(fakeSocket(), { topic: "post:1" }), { ok: false, code: "FORBIDDEN" });
});

test("subscribe: topic cap", async () => {
  const registry = createTopicRegistry({ now: (() => { let t = 0; return () => (t += 1000); })() });
  registry.register("post", async () => true);
  const socket = fakeSocket();
  for (let i = 1; i <= MAX_TOPICS_PER_SOCKET; i += 1) {
    assert.deepEqual(await registry.subscribe(socket, { topic: `post:${i}` }), { ok: true });
  }
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:999" }), { ok: false, code: "TOO_MANY_TOPICS" });
});

test("subscribe: concurrent subscribes cannot overshoot the cap", async () => {
  const registry = createTopicRegistry({ now: (() => { let t = 0; return () => (t += 1000); })() });
  registry.register("post", async () => true);
  const socket = fakeSocket();
  for (let i = 1; i < MAX_TOPICS_PER_SOCKET; i += 1) {
    await registry.subscribe(socket, { topic: `post:${i}` });
  }
  const results = await Promise.all([
    registry.subscribe(socket, { topic: "post:100" }),
    registry.subscribe(socket, { topic: "post:101" }),
  ]);
  assert.equal(socket.data.topics.size, MAX_TOPICS_PER_SOCKET);
  assert.deepEqual(results.filter((r) => r.ok).length, 1);
});

test("subscribe: rate limit of 10 per second", async () => {
  const registry = createTopicRegistry({ now: () => 5_000 });
  registry.register("post", async () => true);
  const socket = fakeSocket();
  for (let i = 1; i <= 10; i += 1) {
    await registry.subscribe(socket, { topic: `post:${i}` });
  }
  assert.deepEqual(await registry.subscribe(socket, { topic: "post:11" }), { ok: false, code: "RATE_LIMITED" });
});

test("unsubscribe leaves and forgets the topic; unknown topics are fine", async () => {
  const registry = createTopicRegistry();
  registry.register("post", async () => true);
  const socket = fakeSocket();
  await registry.subscribe(socket, { topic: "post:1" });
  assert.deepEqual(registry.unsubscribe(socket, { topic: "post:1" }), { ok: true });
  assert.deepEqual(socket.left, ["post:1"]);
  assert.equal(socket.data.topics.size, 0);
  assert.deepEqual(registry.unsubscribe(socket, { topic: "post:2" }), { ok: true });
  assert.deepEqual(registry.unsubscribe(socket, { topic: "bad" }), { ok: false, code: "BAD_TOPIC" });
});
